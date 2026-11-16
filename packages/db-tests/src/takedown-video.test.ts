import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

// task-029c: takedown_video — service_role 전용, 모든 사용자의 해당 video_id 자료 비활성·파생 데이터 삭제·감사 기록.

const SERVICE = { role: "service_role" as const };
const newVideoId = () => `tkd${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const takedown = (videoId: string, reason: string) =>
  as(SERVICE, (c) => c.query<{ r: Record<string, number | string> }>("select public.takedown_video($1, $2) as r", [videoId, reason]), { commit: true });

async function youtubeSource(videoId: string) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, channel_title, duration_seconds, metadata_checked_at, status)
     values ($1, $2, 'youtube', '원래 제목', $3, $4, '원래 채널', 600, now(), 'completed') returning id`,
    [projectId, uid, `https://www.youtube.com/watch?v=${videoId}`, videoId],
  );
  const sourceId = r.rows[0]!.id;
  await admin("insert into public.source_chunks (source_id, project_id, chunk_index, content) values ($1, $2, 0, '청크')", [sourceId, projectId]);
  await admin(
    `insert into public.source_moments (source_id, project_id, user_id, moment_index, locator, title, description)
     values ($1, $2, $3, 0, '{"t_start":0,"t_end":10}'::jsonb, '장면', '설명')`,
    [sourceId, projectId, uid],
  );
  return { uid, projectId, sourceId };
}

const count = async (table: string, sourceId: string) =>
  Number((await admin<{ n: string }>(`select count(*) as n from public.${table} where source_id = $1`, [sourceId])).rows[0]!.n);

describe("takedown_video", () => {
  it("service_role 외에는 실행할 수 없다", async () => {
    const vid = newVideoId();
    const { uid } = await youtubeSource(vid);
    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, sub: uid }]) {
      expect((await failure(actor, "select public.takedown_video($1, '사유')", [vid]))?.code).toBe("42501");
    }
  });

  it("입력을 검증한다", async () => {
    expect((await failure(SERVICE, "select public.takedown_video('short', '사유')"))?.code).toBe("22023");
    expect((await failure(SERVICE, "select public.takedown_video($1, '  ')", [newVideoId()]))?.code).toBe("22023");
  });

  it("모든 사용자의 해당 영상 자료를 비활성 처리하고 청크·장면·요약을 지운다. 다른 영상은 그대로", async () => {
    const vid = newVideoId();
    const a = await youtubeSource(vid);
    const b = await youtubeSource(vid);
    const other = await youtubeSource(newVideoId());
    await admin(
      `insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
       values ($1, $2, $3, gen_random_uuid(), '[{"text":"요약","chunk_ids":[]}]'::jsonb, 'stub')`,
      [a.sourceId, a.projectId, a.uid],
    );

    const res = (await takedown(vid, "권리자 신고 2026-11-12")).rows[0]!.r;
    expect(res.sources).toBe(2);
    expect(res.chunks).toBe(2);
    expect(res.moments).toBe(2);
    expect(res.summaries).toBe(1);

    for (const s of [a, b]) {
      const row = (await admin<{ unavailable_at: Date | null; title: string; channel_title: string | null }>(
        "select unavailable_at, title, channel_title from public.sources where id = $1", [s.sourceId])).rows[0]!;
      expect(row.unavailable_at).not.toBeNull();
      expect(row.title).toBe("확인할 수 없는 영상");
      expect(row.channel_title).toBeNull();
      expect(await count("source_chunks", s.sourceId)).toBe(0);
      expect(await count("source_moments", s.sourceId)).toBe(0);
      expect(await count("source_summaries", s.sourceId)).toBe(0);
    }
    const o = (await admin<{ unavailable_at: Date | null }>("select unavailable_at from public.sources where id = $1", [other.sourceId])).rows[0]!;
    expect(o.unavailable_at).toBeNull();
    expect(await count("source_chunks", other.sourceId)).toBe(1);
  });

  it("감사 기록을 남기고 사용자는 읽을 수 없다. 반복 호출도 안전하다", async () => {
    const vid = newVideoId();
    const { uid, sourceId } = await youtubeSource(vid);
    await takedown(vid, "첫 요청");
    const again = (await takedown(vid, "재요청")).rows[0]!.r;
    expect(again.chunks).toBe(0);
    const audit = await admin<{ reason: string; source_ids: string[]; deleted_chunks: number }>(
      "select reason, source_ids, deleted_chunks from public.rights_takedowns where video_id = $1 order by created_at", [vid]);
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]).toEqual({ reason: "첫 요청", source_ids: [sourceId], deleted_chunks: 1 });
    expect((await failure({ role: "authenticated", sub: uid }, "select * from public.rights_takedowns"))?.code).toBe("42501");
  });

  it("takedown 후 replace_source_moments는 false이고 장면이 다시 생기지 않는다", async () => {
    const vid = newVideoId();
    const { uid, sourceId } = await youtubeSource(vid);
    const job = await admin<{ id: string }>(
      `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
       values ($1, $2, 'source_ingest', 'running', 1, now() + interval '1 minute') returning id`,
      [uid, sourceId],
    );
    await takedown(vid, "권리자 신고");
    const moments = JSON.stringify([{ moment_index: 0, locator: { t_start: 0, t_end: 10 }, title: "장면", description: "설명" }]);
    const r = await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.replace_source_moments($1, 1, $2::jsonb) as ok", [job.rows[0]!.id, moments]), { commit: true });
    expect(r.rows[0]!.ok).toBe(false);
    expect(await count("source_moments", sourceId)).toBe(0);
  });
});
