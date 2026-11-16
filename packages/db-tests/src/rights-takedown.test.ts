import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

// task-029c: takedown_video(service_role 전용) — 여러 사용자 자료 비활성·청크/장면 삭제, 감사 기록, 권한.

const SERVICE = { role: "service_role" as const };

let seq = 0;
const newVideoId = () => `tkd${String(++seq).padStart(4, "0")}${randomUUID().slice(0, 4)}`;

/** 청크 2개·장면 1개가 있는 유튜브 자료 */
async function youtubeSource(videoId: string, opts: { deleted?: boolean } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, status, deleted_at)
     values ($1, $2, 'youtube', '영상', $3, $4, 'completed', case when $5 then now() end) returning id`,
    [projectId, uid, `https://www.youtube.com/watch?v=${videoId}`, videoId, opts.deleted ?? false],
  );
  const sourceId = r.rows[0]!.id;
  await admin(
    `insert into public.source_chunks (source_id, project_id, chunk_index, content, locator)
     values ($1, $2, 0, '첫 구간', '{"t_start":0,"t_end":30}'), ($1, $2, 1, '둘째 구간', '{"t_start":30,"t_end":60}')`,
    [sourceId, projectId],
  );
  await admin(
    `insert into public.source_moments (source_id, project_id, user_id, moment_index, locator, title, description)
     values ($1, $2, $3, 0, '{"t_start":5,"t_end":20}', '장면', '설명')`,
    [sourceId, projectId, uid],
  );
  await admin(
    `insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
     values ($1, $2, $3, gen_random_uuid(), '[{"text":"요약","chunk_ids":[]}]', 'stub')`,
    [sourceId, projectId, uid],
  );
  return { uid, projectId, sourceId };
}

const counts = async (sourceId: string) =>
  (await admin<{ chunks: number; moments: number; summaries: number; unavailable: boolean }>(
    `select (select count(*)::int from public.source_chunks where source_id = $1) as chunks,
            (select count(*)::int from public.source_moments where source_id = $1) as moments,
            (select count(*)::int from public.source_summaries where source_id = $1) as summaries,
            (select unavailable_at is not null from public.sources where id = $1) as unavailable`,
    [sourceId],
  )).rows[0]!;

const takedown = async (videoId: string, reason: string) =>
  (await as(SERVICE, (c) => c.query<{ r: Record<string, number> }>("select public.takedown_video($1, $2) as r", [videoId, reason]), { commit: true }))
    .rows[0]!.r;

describe("takedown_video", () => {
  it("모든 사용자의 같은 영상 자료(삭제된 자료 포함)를 비활성으로 바꾸고 청크·장면·요약을 지운다. 다른 영상은 그대로", async () => {
    const videoId = newVideoId();
    const a = await youtubeSource(videoId);
    const b = await youtubeSource(videoId);
    const deleted = await youtubeSource(videoId, { deleted: true });
    const other = await youtubeSource(newVideoId());

    const r = await takedown(videoId, "권리자 이메일 요청 #1");
    expect(r).toMatchObject({ sources: 3, chunks_deleted: 6, moments_deleted: 3, summaries_deleted: 3, active_jobs: 0 });

    for (const s of [a, b, deleted]) expect(await counts(s.sourceId)).toEqual({ chunks: 0, moments: 0, summaries: 0, unavailable: true });
    expect(await counts(other.sourceId)).toEqual({ chunks: 2, moments: 1, summaries: 1, unavailable: false });

    // 소유자에게도 장면이 보이지 않는다(비활성)
    const visible = await as({ role: "authenticated", sub: a.uid }, (c) =>
      c.query("select id from public.source_moments where source_id = $1", [a.sourceId]),
    );
    expect(visible.rows).toEqual([]);
  });

  it("감사 기록을 남기고, 다시 실행해도 처음 비활성 시각은 유지된다", async () => {
    const videoId = newVideoId();
    const s = await youtubeSource(videoId);
    await takedown(videoId, "  첫 요청  ");
    const first = (await admin<{ unavailable_at: Date }>("select unavailable_at from public.sources where id = $1", [s.sourceId])).rows[0]!.unavailable_at;
    const again = await takedown(videoId, "재실행");
    expect(again).toMatchObject({ sources: 1, chunks_deleted: 0, moments_deleted: 0 });
    const after = (await admin<{ unavailable_at: Date }>("select unavailable_at from public.sources where id = $1", [s.sourceId])).rows[0]!.unavailable_at;
    expect(after.getTime()).toBe(first.getTime());

    const log = await admin(
      `select reason, sources_count, chunks_deleted, moments_deleted, summaries_deleted, active_jobs, created_at is not null as has_time
         from public.rights_takedowns where video_id = $1 order by created_at, reason`,
      [videoId],
    );
    expect(log.rows).toEqual([
      { reason: "첫 요청", sources_count: 1, chunks_deleted: 2, moments_deleted: 1, summaries_deleted: 1, active_jobs: 0, has_time: true },
      { reason: "재실행", sources_count: 1, chunks_deleted: 0, moments_deleted: 0, summaries_deleted: 0, active_jobs: 0, has_time: true },
    ]);
  });

  it("일치하는 자료가 없어도 기록은 남고, 진행 중 수집 작업 수를 알려 준다", async () => {
    expect(await takedown(newVideoId(), "자료 없음")).toMatchObject({ sources: 0, chunks_deleted: 0 });

    const videoId = newVideoId();
    const s = await youtubeSource(videoId);
    await admin("insert into public.processing_jobs (user_id, source_id, job_type) values ($1, $2, 'source_ingest')", [s.uid, s.sourceId]);
    expect(await takedown(videoId, "작업 중")).toMatchObject({ active_jobs: 1 });
    await admin("update public.processing_jobs set status = 'cancelled' where source_id = $1", [s.sourceId]);
  });

  it("진행 중이던 수집 작업이 나중에 청크·장면을 교체하려 해도 false로 거부되어 되살아나지 않는다", async () => {
    const videoId = newVideoId();
    const s = await youtubeSource(videoId);
    const job = await admin<{ id: string }>(
      `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
       values ($1, $2, 'source_ingest', 'running', 1, now() + interval '1 minute') returning id`,
      [s.uid, s.sourceId],
    );
    const jobId = job.rows[0]!.id;
    await takedown(videoId, "수집 중 요청");
    const call = async (sql: string, params: unknown[]) =>
      (await as(SERVICE, (c) => c.query<{ r: boolean }>(sql, params), { commit: true })).rows[0]!.r;
    const chunks = JSON.stringify([{ chunk_index: 0, content: "되살아난 구간", locator: { t_start: 0, t_end: 30 } }]);
    const moments = JSON.stringify([{ moment_index: 0, locator: { t_start: 0, t_end: 10 }, title: "장면", description: "설명" }]);
    expect(await call("select public.replace_source_chunks($1, 1, $2::jsonb) as r", [jobId, chunks])).toBe(false);
    expect(await call("select public.replace_source_moments($1, 1, $2::jsonb) as r", [jobId, moments])).toBe(false);
    expect(await counts(s.sourceId)).toEqual({ chunks: 0, moments: 0, summaries: 0, unavailable: true });
    await admin("update public.processing_jobs set status = 'cancelled' where id = $1", [jobId]);
  });

  it("권리자 삭제된 video_id는 어느 사용자도 다시 등록할 수 없다(KF451). 다른 영상은 등록된다", async () => {
    const videoId = newVideoId();
    await takedown(videoId, "재등록 차단");
    const uid = await createUser();
    const projectId = await createProject(uid);
    const sql = "select public.register_youtube_source($1, $2, $3, '영상', '채널', 60, $4, 'h') as r";
    const err = await failure(SERVICE, sql, [uid, projectId, videoId, randomUUID()]);
    expect(err).toMatchObject({ code: "KF451", message: "video_taken_down" });
    expect((await admin("select 1 from public.sources where project_id = $1", [projectId])).rowCount).toBe(0);
    const ok = await as(SERVICE, (c) => c.query<{ r: { duplicate: boolean } }>(sql, [uid, projectId, newVideoId(), randomUUID()]), { commit: true });
    expect(ok.rows[0]!.r.duplicate).toBe(false);
  });

  it("잘못된 video_id·사유는 22023", async () => {
    expect((await failure(SERVICE, "select public.takedown_video($1, $2)", ["short", "사유"]))?.code).toBe("22023");
    expect((await failure(SERVICE, "select public.takedown_video($1, $2)", [newVideoId(), "   "]))?.code).toBe("22023");
    expect((await failure(SERVICE, "select public.takedown_video($1, $2)", [newVideoId(), null]))?.code).toBe("22023");
  });

  it("authenticated·anon은 실행할 수 없고(42501) 감사 기록을 읽을 수 없다", async () => {
    const uid = await createUser();
    const videoId = newVideoId();
    expect((await failure({ role: "authenticated", sub: uid }, "select public.takedown_video($1, $2)", [videoId, "사유"]))?.code).toBe("42501");
    expect((await failure({ role: "anon" }, "select public.takedown_video($1, $2)", [videoId, "사유"]))?.code).toBe("42501");
    expect((await failure({ role: "authenticated", sub: uid }, "select * from public.rights_takedowns"))?.code).toBe("42501");
    expect((await failure(SERVICE, "select * from public.rights_takedowns"))?.code).toBe("42501");
  });
});
