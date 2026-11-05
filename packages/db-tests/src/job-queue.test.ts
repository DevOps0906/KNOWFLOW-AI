import { randomUUID } from "node:crypto";
import type pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { createPgQueue, type Job } from "../../../apps/worker/src/queue";
import { PermanentError, runOnce } from "../../../apps/worker/src/runner";
import { admin, as, connect, createProject, createUser, failure } from "./db";

const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

/** service_role로 접속한 연결(= Worker가 쓰는 권한) */
async function workerClient(): Promise<pg.Client> {
  const c = await connect();
  await c.query("set role service_role");
  return c;
}

async function makeJob(opts: { maxAttempts?: number; usedQuota?: number } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const source = await admin<{ id: string }>(
    "insert into public.sources (project_id, user_id, source_type, title, original_url) values ($1, $2, 'url', '자료', 'https://example.test/a') returning id",
    [projectId, uid],
  );
  const sourceId = source.rows[0]!.id;
  const job = await admin<{ id: string }>(
    "insert into public.processing_jobs (user_id, source_id, job_type, max_attempts) values ($1, $2, 'source_ingest', $3) returning id",
    [uid, sourceId, opts.maxAttempts ?? 3],
  );
  if (opts.usedQuota) await admin("update public.user_quotas set used_source_jobs = $2 where user_id = $1", [uid, opts.usedQuota]);
  return { uid, projectId, sourceId, jobId: job.rows[0]!.id };
}

const jobRow = async (id: string) =>
  (await admin<{ status: string; attempt_count: number; error_code: string | null; progress: number; locked_until: string | null }>(
    "select status, attempt_count, error_code, progress, locked_until from public.processing_jobs where id = $1",
    [id],
  )).rows[0]!;
const sourceRow = async (id: string) =>
  (await admin<{ status: string; error_code: string | null }>("select status, error_code from public.sources where id = $1", [id])).rows[0]!;
const expireLease = (id: string) =>
  admin("update public.processing_jobs set locked_until = now() - interval '1 second' where id = $1", [id]);
const usedJobs = async (uid: string) =>
  (await admin<{ n: number }>("select used_source_jobs as n from public.user_quotas where user_id = $1", [uid])).rows[0]!.n;

beforeEach(async () => {
  // 다른 테스트가 남긴 대기 작업이 claim을 가로채지 않도록 비운다(파일은 순서대로 실행된다)
  await admin("update public.processing_jobs set status = 'cancelled' where status in ('queued', 'running')");
});

describe("claim_job · 임대", () => {
  it("대기 작업을 running으로 바꾸고 자료를 processing으로 만든다. 다시 부르면 없다", async () => {
    const { jobId, sourceId } = await makeJob();
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      const claimed = await q.claim(60);
      expect(claimed).toMatchObject({ id: jobId, attempt_count: 1 });
      expect(await jobRow(jobId)).toMatchObject({ status: "running", attempt_count: 1 });
      expect((await sourceRow(sourceId)).status).toBe("processing");
      expect(await q.claim(60)).toBeNull();
    } finally {
      await c.end();
    }
  });

  it("동시에 여러 Worker가 가져가도 같은 작업을 두 번 받지 않는다(SKIP LOCKED)", async () => {
    const made = await Promise.all(Array.from({ length: 6 }, () => makeJob()));
    const clients = await Promise.all(Array.from({ length: 6 }, workerClient));
    try {
      const claimed = await Promise.all(clients.map((c) => createPgQueue(c).claim(60)));
      const ids = claimed.map((j) => j?.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(6);
      expect(new Set(made.map((m) => m.jobId))).toEqual(new Set(ids));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("임대가 만료된 running 작업은 회수되어 attempt가 오른다", async () => {
    const { jobId } = await makeJob();
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60); // Worker가 가져간 뒤 강제 종료됐다고 가정
      expect(await q.claim(60)).toBeNull(); // 아직 임대 중이면 가져갈 수 없다
      await expireLease(jobId);
      expect(await q.claim(60)).toMatchObject({ id: jobId, attempt_count: 2 });
    } finally {
      await c.end();
    }
  });

  it("하트비트는 임대를 연장하고, 오래된 attempt의 하트비트는 거부된다", async () => {
    const { jobId } = await makeJob();
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      await admin("update public.processing_jobs set locked_until = now() + interval '11 seconds' where id = $1", [jobId]);
      expect(await q.heartbeat(jobId, 1, 600)).toBe(true);
      const row = await admin<{ secs: number }>(
        "select extract(epoch from locked_until - now())::int as secs from public.processing_jobs where id = $1",
        [jobId],
      );
      expect(row.rows[0]!.secs).toBeGreaterThan(300);
      expect(await q.heartbeat(jobId, 99, 600)).toBe(false);
    } finally {
      await c.end();
    }
  });
});

describe("펜싱: 임대 만료 후 재수령해도 결과가 중복되지 않는다", () => {
  it("이전 시도의 complete·fail·progress는 거부되고 새 시도만 성공시킨다", async () => {
    const { jobId, sourceId } = await makeJob();
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60); // 시도 1
      await expireLease(jobId);
      await q.claim(60); // 시도 2가 가져감
      expect(await q.complete(jobId, 1)).toBe(false);
      expect(await q.fail(jobId, 1, "x", true)).toBe("stale");
      expect(await q.progress(jobId, 1, "old", 10)).toBe(false);
      expect(await jobRow(jobId)).toMatchObject({ status: "running", attempt_count: 2 });

      expect(await q.complete(jobId, 2)).toBe(true);
      expect(await q.complete(jobId, 2)).toBe(false); // 두 번째 완료는 무시
      expect(await q.complete(jobId, 1)).toBe(false);
      expect(await jobRow(jobId)).toMatchObject({ status: "succeeded", progress: 100 });
      expect((await sourceRow(sourceId)).status).toBe("completed");
    } finally {
      await c.end();
    }
  });
});

describe("fail_job · 재시도 한도 · 환불", () => {
  it("재시도 가능하면 다시 대기열로, 한도에 닿으면 최종 실패와 쿼터 환불", async () => {
    const { uid, jobId, sourceId } = await makeJob({ maxAttempts: 2, usedQuota: 1 });
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      expect(await q.fail(jobId, 1, "timeout", true)).toBe("requeued");
      expect(await jobRow(jobId)).toMatchObject({ status: "queued", error_code: "timeout" });
      expect((await sourceRow(sourceId)).status).toBe("queued");
      expect(await usedJobs(uid)).toBe(1);

      await q.claim(60);
      expect(await q.fail(jobId, 2, "timeout", true)).toBe("failed");
      expect(await jobRow(jobId)).toMatchObject({ status: "failed", error_code: "timeout" });
      expect(await sourceRow(sourceId)).toEqual({ status: "failed", error_code: "timeout" });
      expect(await usedJobs(uid)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("재시도 불가 실패는 즉시 최종 실패이고, 형식이 이상한 오류 코드는 unknown으로 저장한다", async () => {
    const { jobId } = await makeJob();
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      expect(await q.fail(jobId, 1, "Bad Code; drop table", false)).toBe("failed");
      expect((await jobRow(jobId)).error_code).toBe("unknown");
    } finally {
      await c.end();
    }
  });

  it("시도 횟수를 다 쓴 채 임대가 만료된 작업은 다음 claim 때 실패로 닫히고 환불된다", async () => {
    const { uid, jobId, sourceId } = await makeJob({ maxAttempts: 1, usedQuota: 1 });
    const c = await workerClient();
    try {
      const q = createPgQueue(c);
      await q.claim(60);
      await expireLease(jobId);
      expect(await q.claim(60)).toBeNull();
      expect(await jobRow(jobId)).toMatchObject({ status: "failed", error_code: "lease_expired" });
      expect(await sourceRow(sourceId)).toEqual({ status: "failed", error_code: "lease_expired" });
      expect(await usedJobs(uid)).toBe(0);
    } finally {
      await c.end();
    }
  });
});

describe("권한", () => {
  it("큐 함수는 service_role만 실행할 수 있다", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of [
        "select public.claim_job(60)",
        "select public.heartbeat_job(gen_random_uuid(), 1, 60)",
        "select public.complete_job(gen_random_uuid(), 1)",
        "select public.fail_job(gen_random_uuid(), 1, 'x', true)",
        "select public.reap_expired_jobs()",
      ]) {
        expect((await failure({ role, sub: randomUUID() }, sql))?.code).toBe("42501");
      }
    }
  });
});

describe("retry_source (A-05)", () => {
  const retrySql = "select public.retry_source($1, $2, $3) as r";
  const retry = (sub: string, sourceId: string, key = randomUUID(), hash = "h") =>
    as(asUser(sub), (c) => c.query<{ r: { job_id: string; duplicate: boolean } }>(retrySql, [sourceId, key, hash]), { commit: true }).then(
      (r) => r.rows[0]!.r,
    );
  const retryFail = (sub: string, sourceId: string, key = randomUUID(), hash = "h") =>
    failure(asUser(sub), retrySql, [sourceId, key, hash]);

  async function failedSource() {
    const made = await makeJob({ usedQuota: 1 });
    await admin("update public.processing_jobs set status = 'failed', error_code = 'x' where id = $1", [made.jobId]);
    await admin("update public.sources set status = 'failed', error_code = 'x' where id = $1", [made.sourceId]);
    return made;
  }

  it("실패한 자료는 새 작업을 만들고 자료를 queued로 되돌리며 쿼터를 다시 차감한다", async () => {
    const { uid, sourceId, jobId } = await failedSource();
    const r = await retry(uid, sourceId);
    expect(r.duplicate).toBe(false);
    expect(r.job_id).not.toBe(jobId);
    expect(await jobRow(r.job_id)).toMatchObject({ status: "queued", attempt_count: 0 });
    expect(await sourceRow(sourceId)).toEqual({ status: "queued", error_code: null });
    expect(await usedJobs(uid)).toBe(2);
  });

  it("진행 중이면 409(KF409), 완료된 자료는 422(22023)", async () => {
    const running = await makeJob(); // queued 작업이 있는 자료
    expect((await retryFail(running.uid, running.sourceId))?.code).toBe("KF409");
    const done = await failedSource();
    await admin("update public.sources set status = 'completed' where id = $1", [done.sourceId]);
    expect((await retryFail(done.uid, done.sourceId))?.code).toBe("22023");
  });

  it("타인의 자료는 P0002, 로그인하지 않으면 28000, anon은 42501", async () => {
    const { sourceId } = await failedSource();
    const other = await createUser();
    expect((await retryFail(other, sourceId))?.code).toBe("P0002");
    expect((await failure({ role: "authenticated" }, retrySql, [sourceId, "k", "h"]))?.code).toBe("28000");
    expect((await failure({ role: "anon" }, retrySql, [sourceId, "k", "h"]))?.code).toBe("42501");
  });

  it("같은 멱등 키 재요청은 새 작업을 만들지 않고, 같은 키·다른 입력은 KF409", async () => {
    const { uid, sourceId } = await failedSource();
    const key = randomUUID();
    const first = await retry(uid, sourceId, key, "h1");
    const again = await retry(uid, sourceId, key, "h1");
    expect(again).toEqual({ job_id: first.job_id, duplicate: true });
    expect((await retryFail(uid, sourceId, key, "h2"))?.code).toBe("KF409");
    const n = await admin<{ n: number }>("select count(*)::int as n from public.processing_jobs where source_id = $1", [sourceId]);
    expect(n.rows[0]!.n).toBe(2);
  });

  it("재시도는 5번까지, 6번째는 429(KF429)", async () => {
    const { uid, sourceId, jobId } = await failedSource();
    let last = jobId;
    for (let i = 0; i < 5; i++) {
      const r = await retry(uid, sourceId);
      last = r.job_id;
      await admin("update public.processing_jobs set status = 'failed', error_code = 'x' where id = $1", [last]);
      await admin("update public.sources set status = 'failed' where id = $1", [sourceId]);
    }
    expect((await retryFail(uid, sourceId))?.code).toBe("KF429");
  });

  it("월 처리 한도를 넘으면 KF429이고 자료·작업은 그대로", async () => {
    const { uid, sourceId } = await failedSource();
    await admin("update public.user_quotas set used_source_jobs = 100 where user_id = $1", [uid]);
    expect((await retryFail(uid, sourceId))?.code).toBe("KF429");
    expect((await sourceRow(sourceId)).status).toBe("failed");
  });
});

describe("Worker 러너 통합(실제 DB)", () => {
  const deps = (c: pg.Client, handlers: Parameters<typeof runOnce>[0]["handlers"]) => ({
    queue: createPgQueue(c),
    handlers,
    leaseSeconds: 60,
    heartbeatSeconds: 20,
    log: () => {},
  });

  it("더미 핸들러로 작업이 queued → running → succeeded로 전이한다", async () => {
    const { jobId, sourceId } = await makeJob();
    const c = await workerClient();
    try {
      const outcome = await runOnce(deps(c, { source_ingest: async ({ progress }) => progress("dummy", 50) }));
      expect(outcome).toBe("succeeded");
      expect(await jobRow(jobId)).toMatchObject({ status: "succeeded", progress: 100, attempt_count: 1 });
      expect((await sourceRow(sourceId)).status).toBe("completed");
      expect(await runOnce(deps(c, {}))).toBe("idle");
    } finally {
      await c.end();
    }
  });

  it("Worker가 죽어 임대가 만료되면 다른 Worker가 회수해 다시 실행한다", async () => {
    const { jobId } = await makeJob();
    const dead = await workerClient();
    const alive = await workerClient();
    try {
      await createPgQueue(dead).claim(60); // 처리 중 강제 종료
      await dead.end();
      await expireLease(jobId);
      expect(await runOnce(deps(alive, { source_ingest: async () => {} }))).toBe("succeeded");
      expect(await jobRow(jobId)).toMatchObject({ status: "succeeded", attempt_count: 2 });
    } finally {
      await alive.end();
    }
  });

  it("느린 Worker가 임대를 잃은 뒤 끝나도 결과는 한 번만 기록된다", async () => {
    const { jobId } = await makeJob();
    const slow = await workerClient();
    const fast = await workerClient();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let handled = 0;
      const slowRun = runOnce(deps(slow, { source_ingest: async () => { handled++; await gate; } }));
      // 느린 Worker가 작업을 잡을 때까지 기다린다
      for (let i = 0; i < 50 && (await jobRow(jobId)).attempt_count === 0; i++) await new Promise((r) => setTimeout(r, 50));
      await expireLease(jobId);
      expect(await runOnce(deps(fast, { source_ingest: async () => { handled++; } }))).toBe("succeeded");
      release();
      expect(await slowRun).toBe("stale");
      expect(handled).toBe(2); // 두 번 실행될 수는 있어도(임대 만료) 결과 기록은 한 번뿐이다
      expect(await jobRow(jobId)).toMatchObject({ status: "succeeded", attempt_count: 2 });
    } finally {
      await slow.end();
      await fast.end();
    }
  });

  it("PermanentError는 최종 실패, 일반 오류는 재시도 한도까지 반복 후 실패", async () => {
    const perm = await makeJob();
    const c = await workerClient();
    try {
      expect(await runOnce(deps(c, { source_ingest: async () => { throw new PermanentError("bad_input"); } }))).toBe("failed");
      expect(await jobRow(perm.jobId)).toMatchObject({ status: "failed", error_code: "bad_input" });

      const flaky = await makeJob({ maxAttempts: 2 });
      const boom = { source_ingest: async () => { throw new Error("boom"); } };
      expect(await runOnce(deps(c, boom))).toBe("requeued");
      expect(await runOnce(deps(c, boom))).toBe("failed");
      expect(await jobRow(flaky.jobId)).toMatchObject({ status: "failed", attempt_count: 2, error_code: "handler_error" });
    } finally {
      await c.end();
    }
  });
});

export type { Job };
