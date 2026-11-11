import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure, sha256Hex } from "./db";

// task-027a: 유튜브 자료 스키마(CHECK·부분 유니크), 영상 시간 쿼터, register_youtube_source, source_moments RLS, replace_source_moments 펜싱.

const SERVICE = { role: "service_role" as const };
const asUser = (sub: string) => ({ role: "authenticated" as const, sub });
const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

let seq = 0;
/** 실행마다 다른 11자 video_id */
const newVideoId = () => `vid${String(++seq).padStart(4, "0")}${randomUUID().slice(0, 4)}`;

const REGISTER_SQL = "select public.register_youtube_source($1, $2, $3, $4, $5, $6, $7, $8) as r";

interface RegisterArgs {
  userId: string;
  projectId: string;
  videoId?: string;
  title?: string;
  channel?: string;
  duration?: number;
  key?: string;
  request?: string;
}
const registerParams = (a: RegisterArgs) => [
  a.userId,
  a.projectId,
  a.videoId ?? newVideoId(),
  a.title ?? "영상 제목",
  a.channel ?? "채널",
  a.duration ?? 600,
  a.key ?? randomUUID(),
  a.request ?? "req-1",
];

async function register(a: RegisterArgs) {
  const r = await as(SERVICE, (c) => c.query<{ r: { source_id: string; job_id: string; duplicate: boolean } }>(REGISTER_SQL, registerParams(a)), {
    commit: true,
  });
  return r.rows[0]!.r;
}
/** 실패를 기다려 SQLSTATE·메시지·HINT를 돌려준다. 성공하면 null */
async function registerFail(a: RegisterArgs, actor: Parameters<typeof failure>[0] = SERVICE) {
  try {
    await as(actor, (c) => c.query(REGISTER_SQL, registerParams(a)));
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string; hint?: string };
    return { code: err.code, message: err.message, hint: err.hint };
  }
}

const quota = async (uid: string) =>
  (await admin<{ used_source_jobs: number; used_video_seconds: number }>(
    "select used_source_jobs, used_video_seconds from public.user_quotas where user_id = $1",
    [uid],
  )).rows[0]!;

async function insertYoutube(uid: string, projectId: string, cols: Record<string, unknown> = {}) {
  const videoId = (cols.video_id as string | undefined) ?? newVideoId();
  const row = {
    project_id: projectId,
    user_id: uid,
    source_type: "youtube",
    title: "영상",
    original_url: watchUrl(videoId),
    video_id: videoId,
    channel_title: "채널",
    duration_seconds: 600,
    metadata_checked_at: new Date().toISOString(),
    ...cols,
  };
  const keys = Object.keys(row);
  const r = await admin<{ id: string }>(
    `insert into public.sources (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
  return r.rows[0]!.id;
}

const insertFailCode = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe("sources 유튜브 CHECK", () => {
  it("youtube는 video_id·정규 original_url 필수, storage_path·content_hash는 null", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    expect(await insertYoutube(uid, projectId)).toBeTruthy();
    const bad: Record<string, unknown>[] = [
      { video_id: null },
      { original_url: null },
      { original_url: "https://youtu.be/abcdefghijk", video_id: "abcdefghijk" },
      { storage_path: `${uid}/${projectId}/a.pdf` },
      { content_hash: sha256Hex(9) },
      { video_id: "short", original_url: watchUrl("short") },
    ];
    for (const cols of bad) expect(await insertFailCode(() => insertYoutube(uid, projectId, cols))).toBe("23514");
  });

  it("다른 유형은 유튜브 컬럼이 null이어야 한다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    for (const col of [
      { video_id: "abcdefghijk" },
      { channel_title: "채널" },
      { duration_seconds: 10 },
      { metadata_checked_at: new Date().toISOString() },
      { video_seconds_charged: 0 },
    ]) {
      const [k, v] = Object.entries(col)[0]!;
      const code = await insertFailCode(() =>
        admin(
          `insert into public.sources (project_id, user_id, source_type, title, storage_path, ${k}) values ($1, $2, 'pdf', '문서', $3, $4)`,
          [projectId, uid, `${uid}/${projectId}/a.pdf`, v],
        ),
      );
      expect(code).toBe("23514");
    }
  });

  it("(project_id, video_id) 중복은 23505, 삭제된 자료는 다시 등록할 수 있다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const videoId = newVideoId();
    const first = await insertYoutube(uid, projectId, { video_id: videoId });
    expect(await insertFailCode(() => insertYoutube(uid, projectId, { video_id: videoId }))).toBe("23505");
    // 다른 프로젝트에는 같은 영상이 들어간다
    expect(await insertYoutube(uid, await createProject(uid), { video_id: videoId })).toBeTruthy();
    await admin("update public.sources set deleted_at = now() where id = $1", [first]);
    expect(await insertYoutube(uid, projectId, { video_id: videoId })).toBeTruthy();
  });
});

describe("register_youtube_source", () => {
  it("queued 자료·작업을 만들고 정규 URL·메타데이터를 저장하며 source_jobs 1·영상 길이만큼 차감한다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const videoId = newVideoId();
    const r = await register({ userId: uid, projectId, videoId, title: "  강의  ", channel: " 채널 ", duration: 1234 });
    expect(r.duplicate).toBe(false);
    const row = await admin(
      `select s.source_type, s.title, s.original_url, s.video_id, s.channel_title, s.duration_seconds, s.status,
              s.storage_path, s.content_hash, s.metadata_checked_at is not null as checked, j.status as job_status, j.job_type
         from public.sources s join public.processing_jobs j on j.source_id = s.id where s.id = $1 and j.id = $2`,
      [r.source_id, r.job_id],
    );
    expect(row.rows[0]).toEqual({
      source_type: "youtube",
      title: "강의",
      original_url: watchUrl(videoId),
      video_id: videoId,
      channel_title: "채널",
      duration_seconds: 1234,
      status: "queued",
      storage_path: null,
      content_hash: null,
      checked: true,
      job_status: "queued",
      job_type: "source_ingest",
    });
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 1234 });
  });

  it("같은 멱등 키 재요청은 기존 결과(duplicate)를 돌려주고 다시 차감하지 않는다. 다른 요청 해시는 KF409", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const args = { userId: uid, projectId, videoId: newVideoId(), key: randomUUID() };
    const a = await register(args);
    const b = await register(args);
    expect(b).toEqual({ ...a, duplicate: true });
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 600 });
    expect((await registerFail({ ...args, request: "req-2" }))?.code).toBe("KF409");
  });

  it("중복 영상은 쿼터·영상 길이 한도보다 먼저 23505(duplicate_video)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const videoId = newVideoId();
    await register({ userId: uid, projectId, videoId });
    await admin("update public.user_quotas set used_source_jobs = 100, used_video_seconds = 72000 where user_id = $1", [uid]);
    expect(await registerFail({ userId: uid, projectId, videoId })).toMatchObject({ code: "23505", message: "duplicate_video" });
    expect(await registerFail({ userId: uid, projectId, videoId, duration: 7201 })).toMatchObject({ code: "23505", message: "duplicate_video" });
  });

  it("월 쿼터 초과 KF429는 HINT로 자원 종류를 구분한다(source_jobs)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    await admin("update public.user_quotas set used_source_jobs = 100 where user_id = $1", [uid]);
    expect(await registerFail({ userId: uid, projectId })).toMatchObject({ code: "KF429", message: "quota_exceeded", hint: "source_jobs" });
  });

  it("같은 프로젝트의 같은 영상은 23505, 삭제 뒤에는 다시 등록된다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const videoId = newVideoId();
    const first = await register({ userId: uid, projectId, videoId });
    expect((await registerFail({ userId: uid, projectId, videoId }))?.code).toBe("23505");
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 600 });
    await admin("update public.sources set deleted_at = now() where id = $1", [first.source_id]);
    expect((await register({ userId: uid, projectId, videoId })).duplicate).toBe(false);
  });

  it("service_role 전용: anon·authenticated는 42501", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    expect((await registerFail({ userId: uid, projectId }, { role: "anon" }))?.code).toBe("42501");
    expect((await registerFail({ userId: uid, projectId }, asUser(uid)))?.code).toBe("42501");
  });

  it("타인 프로젝트·삭제된 프로젝트·없는 프로젝트는 P0002", async () => {
    const owner = await createUser();
    const other = await createUser();
    const projectId = await createProject(owner);
    expect((await registerFail({ userId: other, projectId }))?.code).toBe("P0002");
    const deleted = await createProject(owner);
    await admin("update public.projects set deleted_at = now() where id = $1", [deleted]);
    expect((await registerFail({ userId: owner, projectId: deleted }))?.code).toBe("P0002");
    expect((await registerFail({ userId: owner, projectId: randomUUID() }))?.code).toBe("P0002");
    const n = await admin("select count(*)::int as n from public.sources where user_id in ($1, $2)", [owner, other]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it("잘못된 입력은 22023", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    for (const bad of [
      { videoId: "abc" },
      { videoId: "abcdefghij!" },
      { title: "   " },
      { channel: "" },
      { duration: 0 },
      { key: "" },
    ]) {
      expect((await registerFail({ userId: uid, projectId, ...bad }))?.code).toBe("22023");
    }
  });

  it("영상당 길이 초과는 KF413, 월 영상 시간 초과는 KF429(차감·생성 없음)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    expect((await registerFail({ userId: uid, projectId, duration: 7201 }))?.code).toBe("KF413");
    await admin("update public.user_quotas set used_video_seconds = 72000 - 100 where user_id = $1", [uid]);
    const f = await registerFail({ userId: uid, projectId, duration: 101 });
    expect(f).toMatchObject({ code: "KF429", message: "quota_exceeded", hint: "video_seconds" });
    expect(await quota(uid)).toEqual({ used_source_jobs: 0, used_video_seconds: 71900 });
    // 한도에 딱 맞으면 통과
    await register({ userId: uid, projectId, duration: 100 });
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 72000 });
  });

  it("월 경계가 지나면 영상 시간 누적도 초기화된다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    await admin(
      "update public.user_quotas set period_start = period_start - interval '1 month', used_video_seconds = 72000, used_source_jobs = 100 where user_id = $1",
      [uid],
    );
    await register({ userId: uid, projectId, duration: 300 });
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 300 });
  });

  it("PDF 경로(register_pdf_source)는 그대로 동작하고 영상 시간은 차감하지 않는다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = `${uid}/${projectId}/${randomUUID()}.pdf`;
    await admin("insert into storage.objects (bucket_id, name, owner, metadata) values ('sources', $1, $2, $3)", [
      path,
      uid,
      JSON.stringify({ size: 1000, mimetype: "application/pdf" }),
    ]);
    await as(
      asUser(uid),
      (c) => c.query("select public.register_pdf_source($1, '문서', $2, $3, $4, 'req-1')", [projectId, path, sha256Hex(1), randomUUID()]),
      { commit: true },
    );
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 0 });
    const row = await admin("select video_id, channel_title, duration_seconds, metadata_checked_at from public.sources where project_id = $1", [projectId]);
    expect(row.rows[0]).toEqual({ video_id: null, channel_title: null, duration_seconds: null, metadata_checked_at: null });
  });
});

describe("유튜브 영구 실패 시 영상 시간 환불", () => {
  /** 작업을 마지막 시도로 running 상태로 만든다(Worker claim 흉내) */
  const makeRunningLast = (jobId: string, expired = false) =>
    admin(
      `update public.processing_jobs set status = 'running', attempt_count = max_attempts,
         locked_until = now() + case when $2 then interval '-1 second' else interval '1 minute' end where id = $1`,
      [jobId, expired],
    );
  const failJob = async (jobId: string, retryable: boolean) =>
    (await as(SERVICE, async (c) => {
      const a = await c.query<{ n: number }>("select attempt_count as n from public.processing_jobs where id = $1", [jobId]);
      return (await c.query<{ r: string }>("select public.fail_job($1, $2, 'timeout', $3) as r", [jobId, a.rows[0]!.n, retryable])).rows[0]!.r;
    }, { commit: true }));
  const charged = async (sourceId: string) =>
    (await admin<{ n: number | null }>("select video_seconds_charged as n from public.sources where id = $1", [sourceId])).rows[0]!.n;

  const retry = (uid: string, sourceId: string) =>
    as(asUser(uid), async (c) => (await c.query<{ r: { job_id: string } }>("select public.retry_source($1, $2, 'req-r') as r", [sourceId, randomUUID()])).rows[0]!.r, {
      commit: true,
    });
  const retryFail = async (uid: string, sourceId: string) => {
    try {
      await retry(uid, sourceId);
      return null;
    } catch (e) {
      const err = e as { code?: string; message: string; hint?: string };
      return { code: err.code, message: err.message, hint: err.hint };
    }
  };

  it("fail_job 최종 실패는 source_jobs 1과 영상 시간을 환불하고, 재시도 뒤 다시 실패해도 영상 시간은 한 번만 환불한다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    await register({ userId: uid, projectId, duration: 500 }); // 다른 영상(환불 대상 아님)
    const r = await register({ userId: uid, projectId, duration: 1200 });
    expect(await quota(uid)).toEqual({ used_source_jobs: 2, used_video_seconds: 1700 });
    expect(await charged(r.source_id)).toBe(1200);

    await makeRunningLast(r.job_id);
    expect(await failJob(r.job_id, true)).toBe("failed");
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 500 });
    expect(await charged(r.source_id)).toBe(0);

    // 정산된 유튜브 자료의 재시도는 source_jobs와 영상 시간을 다시 차감하고 charged를 복구한다
    const again = await retry(uid, r.source_id);
    expect(await quota(uid)).toEqual({ used_source_jobs: 2, used_video_seconds: 1700 });
    expect(await charged(r.source_id)).toBe(1200);
    await makeRunningLast(again.job_id);
    expect(await failJob(again.job_id, false)).toBe("failed");
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 500 });
    expect(await charged(r.source_id)).toBe(0);
  });

  it("재시도 때 영상 시간 한도를 넘으면 KF429(HINT video_seconds)로 거부하고 아무것도 바꾸지 않는다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const r = await register({ userId: uid, projectId, duration: 1200 });
    await makeRunningLast(r.job_id);
    expect(await failJob(r.job_id, true)).toBe("failed");
    await admin("update public.user_quotas set used_video_seconds = 72000 - 1000 where user_id = $1", [uid]);
    expect(await retryFail(uid, r.source_id)).toMatchObject({ code: "KF429", message: "quota_exceeded", hint: "video_seconds" });
    expect(await quota(uid)).toEqual({ used_source_jobs: 0, used_video_seconds: 71000 });
    expect(await charged(r.source_id)).toBe(0);
    const jobs = await admin("select count(*)::int as n from public.processing_jobs where source_id = $1", [r.source_id]);
    expect(jobs.rows[0]!.n).toBe(1);
    // source_jobs 한도 초과는 HINT source_jobs
    await admin("update public.user_quotas set used_source_jobs = 100 where user_id = $1", [uid]);
    expect(await retryFail(uid, r.source_id)).toMatchObject({ code: "KF429", message: "quota_exceeded", hint: "source_jobs" });
  });

  it("지난 달에 차감한 영상 시간은 이번 달 사용량에서 빼지 않는다(charged만 0)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const r = await register({ userId: uid, projectId, duration: 1200 });
    // 지난 달에 등록·차감되었고, 이번 달로 넘어와 다른 영상에 300초를 쓴 상황
    await admin(
      "update public.sources set video_seconds_charged_period = video_seconds_charged_period - interval '1 month' where id = $1",
      [r.source_id],
    );
    await admin("update public.user_quotas set used_video_seconds = 300 where user_id = $1", [uid]);
    await makeRunningLast(r.job_id);
    expect(await failJob(r.job_id, false)).toBe("failed");
    expect((await quota(uid)).used_video_seconds).toBe(300);
    expect(await charged(r.source_id)).toBe(0);
  });

  it("재시도 가능한 실패(requeued)는 환불하지 않는다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const r = await register({ userId: uid, projectId, duration: 300 });
    await admin("update public.processing_jobs set status = 'running', attempt_count = 1, locked_until = now() + interval '1 minute' where id = $1", [
      r.job_id,
    ]);
    expect(await failJob(r.job_id, true)).toBe("requeued");
    expect(await quota(uid)).toEqual({ used_source_jobs: 1, used_video_seconds: 300 });
  });

  it("reap_expired_jobs로 닫힌 유튜브 작업도 영상 시간을 한 번 환불한다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const r = await register({ userId: uid, projectId, duration: 900 });
    await makeRunningLast(r.job_id, true);
    await admin("select public.reap_expired_jobs()");
    expect((await admin("select status, error_code from public.processing_jobs where id = $1", [r.job_id])).rows[0]).toEqual({
      status: "failed",
      error_code: "lease_expired",
    });
    expect(await quota(uid)).toEqual({ used_source_jobs: 0, used_video_seconds: 0 });
    expect(await charged(r.source_id)).toBe(0);
  });

  it("refund_quota는 video_seconds를 받고 0 아래로 내리지 않으며 상한(86400)을 넘으면 22023", async () => {
    const uid = await createUser();
    await admin("update public.user_quotas set used_video_seconds = 100 where user_id = $1", [uid]);
    const refund = (n: number) =>
      as(SERVICE, async (c) => (await c.query<{ r: number }>("select public.refund_quota($1, 'video_seconds', $2) as r", [uid, n])).rows[0]!.r, {
        commit: true,
      });
    expect(await refund(86400)).toBe(0);
    expect((await failure(SERVICE, "select public.refund_quota($1, 'video_seconds', 86401)", [uid]))?.code).toBe("22023");
  });
});

async function runningYoutubeJob(opts: { attempt?: number; duration?: number | null } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const sourceId = await insertYoutube(uid, projectId, { duration_seconds: opts.duration === undefined ? 600 : opts.duration });
  const job = await admin<{ id: string }>(
    `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
     values ($1, $2, 'source_ingest', 'running', $3, now() + interval '1 minute') returning id`,
    [uid, sourceId, opts.attempt ?? 1],
  );
  return { uid, projectId, sourceId, jobId: job.rows[0]!.id };
}

const moment = (i: number, tStart = i * 10, tEnd = i * 10 + 5) => ({
  moment_index: i,
  locator: { t_start: tStart, t_end: tEnd },
  title: `장면 ${i}`,
  description: `설명 ${i}`,
});
const momentsJson = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => moment(i)));

const replaceMoments = async (jobId: string, attempt: number, moments: string) =>
  (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.replace_source_moments($1, $2, $3::jsonb) as ok", [jobId, attempt, moments]), {
    commit: true,
  })).rows[0]!.ok;
const momentRows = async (sourceId: string) =>
  (await admin<{ moment_index: number; locator: unknown; user_id: string }>(
    "select moment_index, locator, user_id from public.source_moments where source_id = $1 order by moment_index",
    [sourceId],
  )).rows;

describe("replace_source_moments", () => {
  it("장면을 통째로 교체한다(소유자·프로젝트는 자료에서, locator는 t_start·t_end만)", async () => {
    const { jobId, sourceId, uid } = await runningYoutubeJob();
    expect(await replaceMoments(jobId, 1, momentsJson(3))).toBe(true);
    const extra = JSON.stringify([{ ...moment(0, 1.5, 2.5), locator: { t_start: 1.5, t_end: 2.5, x: 1 } }]);
    expect(await replaceMoments(jobId, 1, extra)).toBe(true);
    expect(await momentRows(sourceId)).toEqual([{ moment_index: 0, locator: { t_start: 1.5, t_end: 2.5 }, user_id: uid }]);
  });

  it("attempt 불일치·running이 아닌 작업·삭제된 자료는 false로 거부하고 기존 장면을 건드리지 않는다", async () => {
    const { jobId, sourceId } = await runningYoutubeJob({ attempt: 2 });
    expect(await replaceMoments(jobId, 2, momentsJson(2))).toBe(true);
    expect(await replaceMoments(jobId, 1, momentsJson(5))).toBe(false);
    expect((await momentRows(sourceId)).length).toBe(2);
    for (const status of ["queued", "succeeded", "failed", "cancelled"]) {
      const j = await runningYoutubeJob();
      await admin(`update public.processing_jobs set status = $2, progress = case when $2 = 'succeeded' then 100 else progress end where id = $1`, [
        j.jobId,
        status,
      ]);
      expect(await replaceMoments(j.jobId, 1, momentsJson(1))).toBe(false);
      expect(await momentRows(j.sourceId)).toEqual([]);
    }
    const d = await runningYoutubeJob();
    await admin("update public.sources set deleted_at = now() where id = $1", [d.sourceId]);
    expect(await replaceMoments(d.jobId, 1, momentsJson(1))).toBe(false);
  });

  it("형식 오류·영상 길이 초과 구간·유튜브가 아닌 자료는 22023", async () => {
    const { jobId, sourceId } = await runningYoutubeJob({ duration: 100 });
    const bad = [
      {},
      [1],
      [moment(0), moment(0)],
      [{ ...moment(0), moment_index: 1.5 }],
      [{ ...moment(0), moment_index: -1 }],
      [moment(0, 5, 5)],
      [moment(0, -1, 5)],
      [{ ...moment(0), locator: { t_start: "0", t_end: 5 } }],
      [{ ...moment(0), title: "" }],
      [{ ...moment(0), description: 3 }],
      [moment(0, 90, 101)],
    ];
    for (const b of bad) await expect(replaceMoments(jobId, 1, JSON.stringify(b))).rejects.toMatchObject({ code: "22023" });
    expect(await momentRows(sourceId)).toEqual([]);

    const uid = await createUser();
    const projectId = await createProject(uid);
    const pdf = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, storage_path) values ($1, $2, 'pdf', '문서', $3) returning id`,
      [projectId, uid, `${uid}/${projectId}/a.pdf`],
    );
    const job = await admin<{ id: string }>(
      `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
       values ($1, $2, 'source_ingest', 'running', 1, now() + interval '1 minute') returning id`,
      [uid, pdf.rows[0]!.id],
    );
    await expect(replaceMoments(job.rows[0]!.id, 1, momentsJson(1))).rejects.toMatchObject({ code: "22023" });
  });

  it("service_role 전용: anon·authenticated는 42501", async () => {
    const { jobId, uid } = await runningYoutubeJob();
    for (const actor of [{ role: "anon" as const }, asUser(uid)]) {
      const f = await failure(actor, "select public.replace_source_moments($1, 1, '[]'::jsonb)", [jobId]);
      expect(f?.code).toBe("42501");
    }
  });
});

describe("source_moments RLS", () => {
  const visible = (sub: string, sourceId: string) =>
    as(asUser(sub), async (c) => (await c.query("select id from public.source_moments where source_id = $1", [sourceId])).rowCount);

  it("소유자만 읽고, 자료가 비활성·삭제되면 숨긴다", async () => {
    const { jobId, sourceId, uid } = await runningYoutubeJob();
    await replaceMoments(jobId, 1, momentsJson(2));
    const other = await createUser();
    expect(await visible(uid, sourceId)).toBe(2);
    expect(await visible(other, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = null, deleted_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
  });

  it("사용자는 쓸 수 없다(INSERT·UPDATE·DELETE 42501), anon은 읽을 수 없다", async () => {
    const { jobId, sourceId, projectId, uid } = await runningYoutubeJob();
    await replaceMoments(jobId, 1, momentsJson(1));
    const writes = [
      [
        `insert into public.source_moments (source_id, project_id, user_id, moment_index, locator, title, description)
         values ($1, $2, $3, 9, '{"t_start":0,"t_end":1}', 't', 'd')`,
        [sourceId, projectId, uid],
      ],
      ["update public.source_moments set title = 'x' where source_id = $1", [sourceId]],
      ["delete from public.source_moments where source_id = $1", [sourceId]],
    ] as const;
    for (const [sql, params] of writes) expect((await failure(asUser(uid), sql, [...params]))?.code).toBe("42501");
    expect((await failure({ role: "anon" }, "select 1 from public.source_moments"))?.code).toBe("42501");
  });
});
