import { randomUUID } from "node:crypto";
import type pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { createPgQueue } from "../../../apps/worker/src/queue";
import { admin, as, connect, createProject, createUser, failure } from "./db";

// task-027d: source_recheck 작업과 큐 함수 job_type 분기(자료 상태·쿼터 불변, 회수 순서), 스윕(배치 상한·중복 없음)·파기, apply_source_recheck 펜싱.

const SERVICE = { role: "service_role" as const };
const asUser = (sub: string) => ({ role: "authenticated" as const, sub });
const PURGED_TITLE = "확인할 수 없는 영상";

let seq = 0;
const newVideoId = () => `rck${String(++seq).padStart(4, "0")}${randomUUID().slice(0, 4)}`;

async function workerClient(): Promise<pg.Client> {
  const c = await connect();
  await c.query("set role service_role");
  return c;
}

/** 쿼터를 차감한 상태의 유튜브 자료(영상 600초). checkedDaysAgo로 마지막 확인 시각을 정한다 */
async function youtubeSource(opts: { status?: string; checkedAt?: string; deleted?: boolean; unavailable?: boolean } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const videoId = newVideoId();
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, channel_title, duration_seconds,
                                 metadata_checked_at, video_seconds_charged, video_seconds_charged_period, status, deleted_at, unavailable_at)
     values ($1, $2, 'youtube', '원래 제목', $3, $4, '원래 채널', 600, $5, 600, public.current_period_start(), $6,
             case when $7 then now() end, case when $8 then now() end)
     returning id`,
    [projectId, uid, `https://www.youtube.com/watch?v=${videoId}`, videoId, opts.checkedAt ?? new Date().toISOString(), opts.status ?? "completed",
      opts.deleted ?? false, opts.unavailable ?? false],
  );
  await admin("update public.user_quotas set used_source_jobs = 1, used_video_seconds = 600 where user_id = $1", [uid]);
  return { uid, projectId, sourceId: r.rows[0]!.id };
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function insertJob(uid: string, sourceId: string, jobType: string, opts: { createdAt?: string; maxAttempts?: number } = {}) {
  const r = await admin<{ id: string }>(
    "insert into public.processing_jobs (user_id, source_id, job_type, max_attempts, created_at) values ($1, $2, $3, $4, coalesce($5::timestamptz, now())) returning id",
    [uid, sourceId, jobType, opts.maxAttempts ?? 3, opts.createdAt ?? null],
  );
  return r.rows[0]!.id;
}

const state = async (uid: string, sourceId: string) =>
  (await admin<{ status: string; error_code: string | null; used_source_jobs: number; used_video_seconds: number; video_seconds_charged: number }>(
    `select s.status, s.error_code, q.used_source_jobs, q.used_video_seconds, s.video_seconds_charged
       from public.sources s join public.user_quotas q on q.user_id = s.user_id where s.id = $2 and s.user_id = $1`,
    [uid, sourceId],
  )).rows[0]!;
const sourceMeta = async (id: string) =>
  (await admin<{ title: string; channel_title: string | null; duration_seconds: number | null; video_seconds_charged: number; unavailable_at: Date | null; metadata_checked_at: Date | null }>(
    "select title, channel_title, duration_seconds, video_seconds_charged, unavailable_at, metadata_checked_at from public.sources where id = $1",
    [id],
  )).rows[0]!;
const jobStatus = async (id: string) =>
  (await admin<{ status: string }>("select status from public.processing_jobs where id = $1", [id])).rows[0]!.status;
const recheckJobs = async (sourceId: string) =>
  (await admin<{ id: string; status: string }>("select id, status from public.processing_jobs where source_id = $1 and job_type = 'source_recheck'", [sourceId])).rows;

const sweep = async (limit: number) =>
  (await as(SERVICE, (c) => c.query<{ r: { enqueued: number; purged: number; cleaned: number; stale_queued: number } }>("select public.sweep_source_rechecks($1) as r", [limit]), { commit: true })).rows[0]!.r;
const apply = async (jobId: string, attempt: number, result: unknown) =>
  (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.apply_source_recheck($1, $2, $3::jsonb) as ok", [jobId, attempt, JSON.stringify(result)]), { commit: true }))
    .rows[0]!.ok;

beforeEach(async () => {
  // 다른 테스트가 남긴 대기 작업이 claim을 가로채지 않도록 비운다(파일은 순서대로 실행된다)
  await admin("update public.processing_jobs set status = 'cancelled' where status in ('queued', 'running')");
});

describe("source_recheck 작업 유형", () => {
  it("source_id가 있어야 하고, 같은 자료에 진행 중 재확인 작업은 1개(수집 작업과는 별개)", async () => {
    const { uid, sourceId } = await youtubeSource();
    const noSource = await failure({}, "insert into public.processing_jobs (user_id, job_type) values ($1, 'source_recheck')", [uid]);
    expect(noSource?.code).toBe("23514");
    await insertJob(uid, sourceId, "source_recheck");
    expect((await failure({}, "insert into public.processing_jobs (user_id, source_id, job_type) values ($1, $2, 'source_recheck')", [uid, sourceId]))?.code).toBe("23505");
    // 재확인 작업이 진행 중이어도 수집 작업은 1개 만들 수 있다
    await insertJob(uid, sourceId, "source_ingest");
    expect((await failure({}, "insert into public.processing_jobs (user_id, source_id, job_type) values ($1, $2, 'source_ingest')", [uid, sourceId]))?.code).toBe("23505");
  });
});

describe("큐 함수 job_type 분기", () => {
  it("claim은 먼저 만든 재확인 작업보다 사용자 수집 작업을 먼저 가져간다", async () => {
    const a = await youtubeSource();
    const b = await youtubeSource({ status: "queued" });
    const recheck = await insertJob(a.uid, a.sourceId, "source_recheck", { createdAt: daysAgo(1) });
    const ingest = await insertJob(b.uid, b.sourceId, "source_ingest");
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      expect((await q.claim(60))?.id).toBe(ingest);
      expect((await q.claim(60))?.id).toBe(recheck);
    } finally {
      await c.end();
    }
  });

  it("재확인 작업의 claim·complete는 자료 상태·쿼터를 바꾸지 않는다", async () => {
    const { uid, sourceId } = await youtubeSource();
    const before = await state(uid, sourceId);
    const jobId = await insertJob(uid, sourceId, "source_recheck");
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      const job = await q.claim(60);
      expect(job).toMatchObject({ id: jobId, job_type: "source_recheck" });
      expect(await state(uid, sourceId)).toEqual(before);
      expect(await q.complete(jobId, 1)).toBe(true);
    } finally {
      await c.end();
    }
    expect(await jobStatus(jobId)).toBe("succeeded");
    expect(await state(uid, sourceId)).toEqual(before);
  });

  it("재확인 작업의 fail(재시도·최종 실패)은 자료 상태를 바꾸지 않고 환불하지 않는다", async () => {
    const { uid, sourceId } = await youtubeSource();
    const before = await state(uid, sourceId);
    const jobId = await insertJob(uid, sourceId, "source_recheck", { maxAttempts: 2 });
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      expect(await q.fail(jobId, 1, "handler_error", true)).toBe("requeued");
      expect(await state(uid, sourceId)).toEqual(before);
      await q.claim(60);
      expect(await q.fail(jobId, 2, "handler_error", true)).toBe("failed");
    } finally {
      await c.end();
    }
    expect(await jobStatus(jobId)).toBe("failed");
    expect(await state(uid, sourceId)).toEqual(before);
  });

  it("시도를 다 쓴 재확인 작업의 임대 만료 회수(reap)도 자료 상태·쿼터를 바꾸지 않는다", async () => {
    const { uid, sourceId } = await youtubeSource();
    const before = await state(uid, sourceId);
    const jobId = await insertJob(uid, sourceId, "source_recheck", { maxAttempts: 1 });
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      await admin("update public.processing_jobs set locked_until = now() - interval '1 second' where id = $1", [jobId]);
      expect(await q.claim(60)).toBeNull();
    } finally {
      await c.end();
    }
    expect((await admin<{ status: string; error_code: string }>("select status, error_code from public.processing_jobs where id = $1", [jobId])).rows[0])
      .toEqual({ status: "failed", error_code: "lease_expired" });
    expect(await state(uid, sourceId)).toEqual(before);
  });

  it("회귀: 수집 작업은 그대로 자료 상태를 바꾸고 최종 실패 시 쿼터·영상 시간을 환불한다", async () => {
    const { uid, sourceId } = await youtubeSource({ status: "queued" });
    const jobId = await insertJob(uid, sourceId, "source_ingest", { maxAttempts: 1 });
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      expect((await state(uid, sourceId)).status).toBe("processing");
      expect(await q.fail(jobId, 1, "handler_error", false)).toBe("failed");
    } finally {
      await c.end();
    }
    expect(await state(uid, sourceId)).toEqual({
      status: "failed", error_code: "handler_error", used_source_jobs: 0, used_video_seconds: 0, video_seconds_charged: 0,
    });
  });

  it("retry_source는 재확인 작업을 세지 않는다(진행 중 재확인이 있어도 재시도, 최근 재확인 실패의 retryable 무시)", async () => {
    const { uid, sourceId } = await youtubeSource({ status: "failed" });
    await insertJob(uid, sourceId, "source_ingest", { createdAt: daysAgo(3) });
    await admin("update public.processing_jobs set status = 'failed', retryable = true where source_id = $1", [sourceId]);
    // 재확인 작업 6개(최근 것은 retryable=false로 끝남) + 진행 중 1개
    for (let i = 0; i < 6; i++) {
      const j = await insertJob(uid, sourceId, "source_recheck", { createdAt: daysAgo(2) });
      await admin("update public.processing_jobs set status = 'failed', retryable = false where id = $1", [j]);
    }
    await insertJob(uid, sourceId, "source_recheck");
    const r = await as(asUser(uid), (c) => c.query<{ r: { job_id: string; duplicate: boolean } }>("select public.retry_source($1, $2, 'h') as r", [sourceId, randomUUID()]), { commit: true });
    expect(r.rows[0]!.r.duplicate).toBe(false);
    expect((await state(uid, sourceId)).status).toBe("queued");
  });
});

describe("sweep_source_rechecks", () => {
  it("21일 지난 유튜브 자료만 재확인 작업을 만들고(쿼터 불변), 다시 돌려도 중복이 없다", async () => {
    const due = await youtubeSource({ checkedAt: daysAgo(22) });
    const fresh = await youtubeSource({ checkedAt: daysAgo(20) });
    const deleted = await youtubeSource({ checkedAt: daysAgo(22), deleted: true });
    const unavailable = await youtubeSource({ checkedAt: daysAgo(22), unavailable: true });
    const before = await state(due.uid, due.sourceId);

    expect((await sweep(1000)).enqueued).toBeGreaterThanOrEqual(1);
    expect(await recheckJobs(due.sourceId)).toHaveLength(1);
    expect((await admin("select user_id from public.processing_jobs where source_id = $1", [due.sourceId])).rows[0]).toEqual({ user_id: due.uid });
    for (const s of [fresh, deleted, unavailable]) expect(await recheckJobs(s.sourceId)).toHaveLength(0);
    expect(await state(due.uid, due.sourceId)).toEqual(before);

    // 진행 중이면 중복 없음
    await sweep(1000);
    expect(await recheckJobs(due.sourceId)).toHaveLength(1);
    // 실패로 끝나도 20시간 안에는 다시 만들지 않는다
    await admin("update public.processing_jobs set status = 'failed' where source_id = $1", [due.sourceId]);
    await sweep(1000);
    expect(await recheckJobs(due.sourceId)).toHaveLength(1);
    // 20시간이 지나면 다시 만든다
    await admin("update public.processing_jobs set created_at = now() - interval '21 hours' where source_id = $1", [due.sourceId]);
    await sweep(1000);
    expect(await recheckJobs(due.sourceId)).toHaveLength(2);
  });

  it("배치 상한만큼 오래된 순으로 만들고, 상한 범위 밖은 22023", async () => {
    await sweep(1000); // 앞 테스트가 남긴 대상 비우기
    const s1 = await youtubeSource({ checkedAt: "1990-01-01T00:00:00Z" });
    const s2 = await youtubeSource({ checkedAt: "1990-01-02T00:00:00Z" });
    const s3 = await youtubeSource({ checkedAt: "1990-01-03T00:00:00Z" });
    expect((await sweep(2)).enqueued).toBe(2);
    expect((await recheckJobs(s1.sourceId)).length + (await recheckJobs(s2.sourceId)).length).toBe(2);
    expect(await recheckJobs(s3.sourceId)).toHaveLength(0);
    for (const bad of [0, 1001]) {
      expect((await failure(SERVICE, "select public.sweep_source_rechecks($1)", [bad]))?.code).toBe("22023");
    }
  });

  it("파기: 29일 지났거나 비활성·삭제된 자료의 메타데이터를 지우고 차감한 영상 시간은 유지한다", async () => {
    const old = await youtubeSource({ checkedAt: daysAgo(29.5) });
    const unavailable = await youtubeSource({ unavailable: true });
    const deletedOld = await youtubeSource({ checkedAt: daysAgo(40), deleted: true });
    const recent = await youtubeSource({ checkedAt: daysAgo(28) });
    expect((await sweep(1000)).purged).toBeGreaterThanOrEqual(3);
    for (const s of [old, unavailable, deletedOld]) {
      expect(await sourceMeta(s.sourceId)).toMatchObject({ title: PURGED_TITLE, channel_title: null, duration_seconds: null, video_seconds_charged: 600 });
    }
    expect(await sourceMeta(recent.sourceId)).toMatchObject({ title: "원래 제목", channel_title: "원래 채널", duration_seconds: 600 });
    // 파기됐어도 비활성이 아니면 재확인 대상이다(갱신되면 복구)
    expect(await recheckJobs(old.sourceId)).toHaveLength(1);
    // 이미 파기된 자료는 다시 세지 않는다
    expect(await sweep(1000)).toMatchObject({ purged: 0 });
  });
});

describe("apply_source_recheck", () => {
  async function runningRecheck(opts: Parameters<typeof youtubeSource>[0] = {}) {
    const s = await youtubeSource(opts);
    const jobId = await insertJob(s.uid, s.sourceId, "source_recheck");
    await admin("update public.processing_jobs set status = 'running', attempt_count = 1, locked_until = now() + interval '1 minute' where id = $1", [jobId]);
    return { ...s, jobId };
  }

  it("available: 실제 길이·제목·채널로 갱신하고 metadata_checked_at을 새로 한다(상태·쿼터·차감 불변)", async () => {
    const r = await runningRecheck({ checkedAt: daysAgo(22) });
    const before = await state(r.uid, r.sourceId);
    expect(await apply(r.jobId, 1, { kind: "available", title: " 새 제목 ", channel_title: "새 채널", duration_seconds: 615 })).toBe(true);
    const meta = await sourceMeta(r.sourceId);
    expect(meta).toMatchObject({ title: "새 제목", channel_title: "새 채널", duration_seconds: 615, unavailable_at: null, video_seconds_charged: 600 });
    expect(Date.now() - meta.metadata_checked_at!.getTime()).toBeLessThan(60_000);
    expect(await state(r.uid, r.sourceId)).toEqual(before);
  });

  it("unavailable: unavailable_at을 설정하고 즉시 파기한다", async () => {
    const r = await runningRecheck();
    expect(await apply(r.jobId, 1, { kind: "unavailable" })).toBe(true);
    const meta = await sourceMeta(r.sourceId);
    expect(meta.unavailable_at).not.toBeNull();
    expect(meta).toMatchObject({ title: PURGED_TITLE, channel_title: null, duration_seconds: null, video_seconds_charged: 600 });
    expect((await state(r.uid, r.sourceId)).status).toBe("completed");
  });

  it("펜싱: 다른 attempt·끝난 작업·수집 작업이면 false로 아무것도 바꾸지 않는다", async () => {
    const r = await runningRecheck();
    const ok = { kind: "available", title: "x", channel_title: "y", duration_seconds: 1 };
    expect(await apply(r.jobId, 2, ok)).toBe(false);
    const ingest = await youtubeSource({ status: "processing" });
    const ingestJob = await insertJob(ingest.uid, ingest.sourceId, "source_ingest");
    await admin("update public.processing_jobs set status = 'running', attempt_count = 1 where id = $1", [ingestJob]);
    expect(await apply(ingestJob, 1, ok)).toBe(false);
    await admin("update public.processing_jobs set status = 'succeeded', progress = 100 where id = $1", [r.jobId]);
    expect(await apply(r.jobId, 1, ok)).toBe(false);
    expect(await sourceMeta(r.sourceId)).toMatchObject({ title: "원래 제목", duration_seconds: 600 });
  });

  it("삭제된 자료·비활성 자료(available)는 바꾸지 않고 true", async () => {
    const d = await runningRecheck({ deleted: true });
    expect(await apply(d.jobId, 1, { kind: "unavailable" })).toBe(true);
    expect((await sourceMeta(d.sourceId)).unavailable_at).toBeNull();
    const u = await runningRecheck({ unavailable: true });
    expect(await apply(u.jobId, 1, { kind: "available", title: "x", channel_title: "y", duration_seconds: 5 })).toBe(true);
    expect(await sourceMeta(u.sourceId)).toMatchObject({ title: "원래 제목", duration_seconds: 600 });
  });

  it("결과 형식 오류는 22023", async () => {
    const r = await runningRecheck();
    const bad = [
      null,
      { kind: "maybe" },
      { kind: "available", title: "", channel_title: "c", duration_seconds: 1 },
      { kind: "available", title: "t", channel_title: "c", duration_seconds: 0 },
      { kind: "available", title: "t", channel_title: "c", duration_seconds: 1.5 },
      { kind: "available", title: "t", channel_title: "c", duration_seconds: "60" },
      { kind: "available", title: "t".repeat(301), channel_title: "c", duration_seconds: 1 },
    ];
    for (const b of bad) {
      expect((await failure(SERVICE, "select public.apply_source_recheck($1, 1, $2::jsonb)", [r.jobId, JSON.stringify(b)]))?.code).toBe("22023");
    }
  });

  it("두 함수는 service_role만 실행할 수 있다", async () => {
    const uid = await createUser();
    for (const actor of [asUser(uid), { role: "anon" as const }]) {
      expect((await failure(actor, "select public.sweep_source_rechecks(1)"))?.code).toBe("42501");
      expect((await failure(actor, "select public.apply_source_recheck($1, 1, '{\"kind\":\"unavailable\"}')", [randomUUID()]))?.code).toBe("42501");
    }
  });
});

describe("재확인 작업과 사용자 계약 분리", () => {
  it("register_youtube_source 멱등 재요청은 재확인 작업이 더 최신이어도 수집 작업 ID를 돌려준다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const key = randomUUID();
    const params = [uid, projectId, newVideoId(), "제목", "채널", 600, key, "req-1"];
    const sql = "select public.register_youtube_source($1, $2, $3, $4, $5, $6, $7, $8) as r";
    const first = (await as(SERVICE, (c) => c.query<{ r: { source_id: string; job_id: string } }>(sql, params), { commit: true })).rows[0]!.r;
    await admin("update public.processing_jobs set status = 'succeeded', progress = 100 where id = $1", [first.job_id]);
    await insertJob(uid, first.source_id, "source_recheck", { createdAt: new Date(Date.now() + 60_000).toISOString() });
    const again = (await as(SERVICE, (c) => c.query<{ r: { job_id: string; duplicate: boolean } }>(sql, params), { commit: true })).rows[0]!.r;
    expect(again).toMatchObject({ job_id: first.job_id, duplicate: true });
  });

  it("enqueue_job 멱등 재요청도 수집 작업 ID를 돌려준다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const key = randomUUID();
    const sql = "select public.enqueue_job($1, 'url', '자료', 'https://example.test/a', null, null, $2, 'h') as r";
    const first = (await as({ sub: uid }, (c) => c.query<{ r: { source_id: string; job_id: string } }>(sql, [projectId, key]), { commit: true })).rows[0]!.r;
    await insertJob(uid, first.source_id, "source_recheck", { createdAt: new Date(Date.now() + 60_000).toISOString() });
    const again = (await as({ sub: uid }, (c) => c.query<{ r: { job_id: string; duplicate: boolean } }>(sql, [projectId, key]), { commit: true })).rows[0]!.r;
    expect(again).toMatchObject({ job_id: first.job_id, duplicate: true });
  });

  it("list_project_jobs는 재확인 작업을 보여주지 않는다", async () => {
    const { uid, projectId, sourceId } = await youtubeSource();
    const ingest = await insertJob(uid, sourceId, "source_ingest", { createdAt: daysAgo(1) });
    await insertJob(uid, sourceId, "source_recheck");
    const rows = (await as(asUser(uid), (c) => c.query<{ id: string; job_type: string }>("select id, job_type from public.list_project_jobs($1)", [projectId]))).rows;
    expect(rows).toEqual([{ id: ingest, job_type: "source_ingest" }]);
  });
});

describe("027d 리뷰 반영: 결과 없음 2회 연속·스윕 순서·정리·밀림 경고", () => {
  async function runningRecheckFor(uid: string, sourceId: string) {
    const jobId = await insertJob(uid, sourceId, "source_recheck");
    await admin("update public.processing_jobs set status = 'running', attempt_count = 1, locked_until = now() + interval '1 minute' where id = $1", [jobId]);
    return jobId;
  }
  const finish = (jobId: string) => admin("update public.processing_jobs set status = 'succeeded', progress = 100 where id = $1", [jobId]);
  const missingCount = async (id: string) =>
    (await admin<{ n: number }>("select recheck_missing_count as n from public.sources where id = $1", [id])).rows[0]!.n;

  it("결과 없음은 1회면 그대로(확인 시각 유지), 2회 연속이면 비활성·파기", async () => {
    const checkedAt = daysAgo(22);
    const s = await youtubeSource({ checkedAt });
    const j1 = await runningRecheckFor(s.uid, s.sourceId);
    expect(await apply(j1, 1, { kind: "missing" })).toBe(true);
    await finish(j1);
    expect(await missingCount(s.sourceId)).toBe(1);
    expect(await sourceMeta(s.sourceId)).toMatchObject({ unavailable_at: null, title: "원래 제목", duration_seconds: 600 });
    expect((await sourceMeta(s.sourceId)).metadata_checked_at!.toISOString()).toBe(new Date(checkedAt).toISOString());
    const j2 = await runningRecheckFor(s.uid, s.sourceId);
    expect(await apply(j2, 1, { kind: "missing" })).toBe(true);
    const meta = await sourceMeta(s.sourceId);
    expect(meta.unavailable_at).not.toBeNull();
    expect(meta).toMatchObject({ title: PURGED_TITLE, channel_title: null, duration_seconds: null, video_seconds_charged: 600 });
  });

  it("정상 응답은 연속 횟수를 0으로 되돌린다", async () => {
    const s = await youtubeSource();
    const j1 = await runningRecheckFor(s.uid, s.sourceId);
    await apply(j1, 1, { kind: "missing" });
    await finish(j1);
    const j2 = await runningRecheckFor(s.uid, s.sourceId);
    await apply(j2, 1, { kind: "available", title: "t", channel_title: "c", duration_seconds: 600 });
    await finish(j2);
    expect(await missingCount(s.sourceId)).toBe(0);
    const j3 = await runningRecheckFor(s.uid, s.sourceId);
    await apply(j3, 1, { kind: "missing" });
    expect((await sourceMeta(s.sourceId)).unavailable_at).toBeNull();
  });

  it("3일 안에 재확인이 실패한 자료는 배치 뒤로 밀린다(더 오래됐어도)", async () => {
    await sweep(1000);
    const failing = await youtubeSource({ checkedAt: "1980-01-01T00:00:00Z" });
    const failedJob = await insertJob(failing.uid, failing.sourceId, "source_recheck", { createdAt: daysAgo(1) });
    await admin("update public.processing_jobs set status = 'failed', finished_at = now() where id = $1", [failedJob]);
    await admin("update public.processing_jobs set created_at = now() - interval '21 hours' where id = $1", [failedJob]);
    const normal = await youtubeSource({ checkedAt: "1985-01-01T00:00:00Z" });
    expect((await sweep(1)).enqueued).toBe(1);
    expect(await recheckJobs(normal.sourceId)).toHaveLength(1);
    expect(await recheckJobs(failing.sourceId)).toHaveLength(1); // 실패한 1건뿐
    expect((await sweep(1)).enqueued).toBe(1);
    expect(await recheckJobs(failing.sourceId)).toHaveLength(2);
  });

  it("끝난 지 7일 지난 failed 재확인 작업은 지우고, 24시간 넘게 queued인 재확인 작업 수를 돌려준다", async () => {
    const s = await youtubeSource();
    const oldFailed = await insertJob(s.uid, s.sourceId, "source_recheck", { createdAt: daysAgo(9) });
    await admin("update public.processing_jobs set status = 'failed', finished_at = now() - interval '8 days' where id = $1", [oldFailed]);
    const recentFailed = await insertJob(s.uid, s.sourceId, "source_recheck", { createdAt: daysAgo(2) });
    await admin("update public.processing_jobs set status = 'failed', finished_at = now() - interval '2 days' where id = $1", [recentFailed]);
    const oldIngestFailed = await insertJob(s.uid, s.sourceId, "source_ingest", { createdAt: daysAgo(9) });
    await admin("update public.processing_jobs set status = 'failed', finished_at = now() - interval '8 days' where id = $1", [oldIngestFailed]);
    await insertJob(s.uid, s.sourceId, "source_recheck", { createdAt: daysAgo(2) }); // 하루 넘게 queued
    const r = await sweep(1000);
    expect(r.cleaned).toBeGreaterThanOrEqual(1);
    expect((r as { stale_queued?: number }).stale_queued).toBeGreaterThanOrEqual(1);
    const left = (await admin<{ id: string }>("select id from public.processing_jobs where source_id = $1", [s.sourceId])).rows.map((x) => x.id);
    expect(left).not.toContain(oldFailed);
    expect(left).toEqual(expect.arrayContaining([recentFailed, oldIngestFailed]));
  });
});
