import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { verifyDbIdentity } from "./db.js";
import { sanitize } from "./log.js";
import type { FailResult, Job, JobQueue } from "./queue.js";
import { backoffMs, PermanentError, runOnce, StaleAttemptError, type Handlers } from "./runner.js";

const job: Job = {
  id: "j1",
  user_id: "u1",
  source_id: "s1",
  report_id: null,
  job_type: "source_ingest",
  attempt_count: 2,
  max_attempts: 3,
};

function fakeQueue(over: Partial<JobQueue> = {}): JobQueue & { calls: string[] } {
  const calls: string[] = [];
  const q: JobQueue = {
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => true),
    progress: vi.fn(async () => true),
    complete: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    fail: vi.fn(async (_id, _a, code, retryable): Promise<FailResult> => {
      calls.push(`fail:${code}:${retryable}`);
      return retryable ? "requeued" : "failed";
    }),
    ...over,
  };
  return Object.assign(q, { calls });
}

const run = (queue: JobQueue, handlers: Handlers, heartbeatSeconds = 30) =>
  runOnce({ queue, handlers, leaseSeconds: 120, heartbeatSeconds, log: () => {} });

describe("runOnce", () => {
  it("가져올 작업이 없으면 idle", async () => {
    expect(await run(fakeQueue({ claim: async () => null }), {})).toBe("idle");
  });

  it("핸들러가 끝나면 현재 시도 번호로 complete 한다", async () => {
    const q = fakeQueue();
    expect(await run(q, { source_ingest: async () => {} })).toBe("succeeded");
    expect(q.complete).toHaveBeenCalledWith("j1", 2);
  });

  it("complete가 거부되면(다른 시도가 가져감) stale로 끝나고 재실행하지 않는다", async () => {
    const q = fakeQueue({ complete: vi.fn(async () => false) });
    expect(await run(q, { source_ingest: async () => {} })).toBe("stale");
  });

  it("일반 오류는 재시도 가능 실패, PermanentError는 즉시 최종 실패", async () => {
    const q1 = fakeQueue();
    expect(await run(q1, { source_ingest: async () => { throw new Error("boom"); } })).toBe("requeued");
    expect(q1.calls).toEqual(["fail:handler_error:true"]);
    const q2 = fakeQueue();
    expect(await run(q2, { source_ingest: async () => { throw new PermanentError("bad_input"); } })).toBe("failed");
    expect(q2.calls).toEqual(["fail:bad_input:false"]);
  });

  it("핸들러가 없는 작업 유형은 최종 실패(no_handler)", async () => {
    const q = fakeQueue();
    expect(await run(q, {})).toBe("failed");
    expect(q.calls).toEqual(["fail:no_handler:false"]);
  });

  it("하트비트가 거부되면(임대 상실) 핸들러를 중단시키고 결과를 내지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const q = fakeQueue({ heartbeat: vi.fn(async () => false) });
      const promise = run(
        q,
        {
          source_ingest: ({ signal }) =>
            new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
        },
        1,
      );
      await vi.advanceTimersByTimeAsync(1500);
      expect(await promise).toBe("stale");
      expect(q.complete).not.toHaveBeenCalled();
      expect(q.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("하트비트 오류가 이어져 마지막 성공 후 임대 시간을 넘기면 핸들러를 중단하고 결과를 내지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const q = fakeQueue({ heartbeat: vi.fn(async () => { throw new Error("db down"); }) });
      let abortedAt = 0;
      const start = Date.now();
      const promise = runOnce({
        queue: q,
        handlers: {
          source_ingest: ({ signal }) =>
            new Promise((_, reject) =>
              signal.addEventListener("abort", () => {
                abortedAt = Date.now() - start;
                reject(new Error("aborted"));
              }),
            ),
        },
        leaseSeconds: 20,
        heartbeatSeconds: 5,
        log: () => {},
      });
      await vi.advanceTimersByTimeAsync(19_000);
      expect(abortedAt).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await promise).toBe("stale");
      expect(abortedAt).toBe(20_000);
      expect(q.complete).not.toHaveBeenCalled();
      expect(q.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("하트비트가 응답하지 않아도(멈춤) 임대 시간을 넘기면 핸들러를 중단한다", async () => {
    vi.useFakeTimers();
    try {
      const q = fakeQueue({ heartbeat: vi.fn(() => new Promise<boolean>(() => {})) });
      const promise = runOnce({
        queue: q,
        handlers: {
          source_ingest: ({ signal }) =>
            new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
        },
        leaseSeconds: 20,
        heartbeatSeconds: 5,
        log: () => {},
      });
      await vi.advanceTimersByTimeAsync(20_500);
      expect(await promise).toBe("stale");
      expect(q.complete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("하트비트가 성공하는 동안은 임대 시간을 넘겨도 중단하지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const q = fakeQueue();
      let aborted = false;
      const promise = runOnce({
        queue: q,
        handlers: {
          source_ingest: async ({ signal }) => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 60_000));
          },
        },
        leaseSeconds: 20,
        heartbeatSeconds: 5,
        log: () => {},
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await promise).toBe("succeeded");
      expect(aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["거부", false],
    ["성공", true],
  ])("작업이 끝난 뒤 도착한 하트비트 응답(%s)은 무시한다", async (_name, heartbeatOk) => {
    vi.useFakeTimers();
    try {
      let settle!: (ok: boolean) => void;
      const q = fakeQueue({ heartbeat: vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; })) });
      const events: string[] = [];
      const promise = runOnce({
        queue: q,
        handlers: { source_ingest: () => new Promise((resolve) => setTimeout(resolve, 1500)) },
        leaseSeconds: 20,
        heartbeatSeconds: 1,
        log: (e) => events.push(e.event),
      });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await promise).toBe("succeeded");
      settle(heartbeatOk);
      await vi.advanceTimersByTimeAsync(0);
      expect(events).not.toContain("lease_lost");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("임대를 잃으면 핸들러가 끝나기 전이라도 하트비트를 멈춘다", async () => {
    vi.useFakeTimers();
    try {
      const q = fakeQueue({ heartbeat: vi.fn(async () => false) });
      const promise = run(q, { source_ingest: () => new Promise((resolve) => setTimeout(resolve, 5000)) }, 1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await promise).toBe("stale");
      expect(q.heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("핸들러가 이미 완료했으면(completed) complete를 부르지 않고, 후행 단계 실패는 결과를 바꾸지 않는다", async () => {
    const q = fakeQueue();
    const after = vi.fn(async () => {
      throw new Error("요약 실패");
    });
    expect(await run(q, { source_ingest: async () => ({ completed: true, afterComplete: after }) })).toBe("succeeded");
    expect(q.complete).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
    expect(q.calls).toEqual([]);
  });

  it("펜싱 거부(StaleAttemptError)는 실패로 기록하지 않고 stale, 후행 단계도 돌지 않는다", async () => {
    const q = fakeQueue();
    expect(await run(q, { source_ingest: async () => { throw new StaleAttemptError(); } })).toBe("stale");
    expect(q.calls).toEqual([]);
    const after = vi.fn(async () => {});
    const q2 = fakeQueue({ complete: vi.fn(async () => false) });
    expect(await run(q2, { source_ingest: async () => ({ afterComplete: after }) })).toBe("stale");
    expect(after).not.toHaveBeenCalled();
  });

  it("진행률은 0~99로 제한해 전달한다", async () => {
    const q = fakeQueue();
    await run(q, { source_ingest: async ({ progress }) => { await progress("x", 250); await progress("y", -5); } });
    expect(q.progress).toHaveBeenNthCalledWith(1, "j1", 2, "x", 99);
    expect(q.progress).toHaveBeenNthCalledWith(2, "j1", 2, "y", 0);
  });
});

describe("backoffMs", () => {
  it("연속 실패마다 두 배로 늘고 상한을 넘지 않는다", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 1000))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(50, 1000)).toBe(30_000);
    expect(backoffMs(0, 1000)).toBe(1000);
  });
});

describe("verifyDbIdentity", () => {
  const db = (row: unknown) => ({ query: vi.fn(async () => ({ rows: row === undefined ? [] : [row] })) }) as never;
  const ok = { current_role: "service_role", session_super: false, current_super: false };

  it("비슈퍼유저 접속 + 지정 역할이면 통과한다", async () => {
    await expect(verifyDbIdentity(db(ok), "service_role")).resolves.toBeUndefined();
  });
  it("슈퍼유저 접속이면 기동을 거부한다", async () => {
    await expect(verifyDbIdentity(db({ ...ok, session_super: true }), "service_role")).rejects.toMatchObject({ code: "db_superuser_refused" });
    await expect(verifyDbIdentity(db({ ...ok, current_super: true }), "service_role")).rejects.toMatchObject({ code: "db_superuser_refused" });
  });
  it("SET ROLE이 적용되지 않았으면 기동을 거부한다", async () => {
    await expect(verifyDbIdentity(db({ ...ok, current_role: "knowflow_worker" }), "service_role")).rejects.toMatchObject({ code: "db_role_not_set" });
  });
  it("행을 읽지 못하면 거부한다", async () => {
    await expect(verifyDbIdentity(db(undefined), "service_role")).rejects.toMatchObject({ code: "db_superuser_refused" });
  });
});

describe("config · log", () => {
  it("DATABASE_URL이 없으면 거부하고 범위를 벗어난 값도 거부한다", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", WORKER_LEASE_SECONDS: "5" })).toThrow(/WORKER_LEASE_SECONDS/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", WORKER_LEASE_SECONDS: "20", WORKER_HEARTBEAT_SECONDS: "15" })).toThrow(/heartbeat/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", WORKER_DB_ROLE: "x; drop table y" })).toThrow(/WORKER_DB_ROLE/);
  });
  it("기본값을 채운다", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x" })).toMatchObject({ dbRole: "service_role", leaseSeconds: 120, dummyHandlers: false });
  });
  it("더미 핸들러는 compose db·loopback DB에서만 허용한다", () => {
    for (const host of ["db", "localhost", "127.0.0.1", "[::1]"]) {
      expect(loadConfig({ DATABASE_URL: `postgres://u:p@${host}:5432/k`, WORKER_DUMMY_HANDLERS: "1" }).dummyHandlers).toBe(true);
    }
    for (const url of ["postgres://u:p@db.abc.supabase.co:5432/k", "postgres://u:p@10.0.0.5:5432/k", "not a url"]) {
      expect(() => loadConfig({ DATABASE_URL: url, WORKER_DUMMY_HANDLERS: "1" })).toThrow(/DATABASE_URL 형식|더미 핸들러/);
    }
    expect(loadConfig({ DATABASE_URL: "postgres://u:p@db.abc.supabase.co:5432/k" }).dummyHandlers).toBe(false);
  });
  it("고정 파일 어댑터·스텁 요약은 로컬 DB에서만, 기본값은 storage·none", () => {
    const local = "postgres://u:p@db:5432/k";
    const remote = "postgres://u:p@db.abc.supabase.co:5432/k";
    expect(loadConfig({ DATABASE_URL: remote })).toMatchObject({ sourceReader: "storage", fixtureDir: null, summaryProvider: "none" });
    expect(loadConfig({ DATABASE_URL: local, WORKER_SOURCE_READER: "fixture", WORKER_FIXTURE_DIR: "/fixtures", WORKER_SUMMARY_PROVIDER: "stub" })).toMatchObject({
      sourceReader: "fixture",
      fixtureDir: "/fixtures",
      summaryProvider: "stub",
    });
    expect(() => loadConfig({ DATABASE_URL: local, WORKER_SOURCE_READER: "fixture" })).toThrow(/WORKER_FIXTURE_DIR/);
    expect(() => loadConfig({ DATABASE_URL: remote, WORKER_SOURCE_READER: "fixture", WORKER_FIXTURE_DIR: "/f" })).toThrow(/고정 파일 어댑터/);
    expect(() => loadConfig({ DATABASE_URL: remote, WORKER_SUMMARY_PROVIDER: "stub" })).toThrow(/스텁 요약/);
    expect(() => loadConfig({ DATABASE_URL: local, WORKER_SUMMARY_PROVIDER: "openai" })).toThrow(/WORKER_SUMMARY_PROVIDER/);
  });
  it("설정 오류 메시지에 연결 문자열이 들어가지 않는다", () => {
    try {
      loadConfig({ DATABASE_URL: "postgres://u:s3cret@remote.example:5432/k", WORKER_DUMMY_HANDLERS: "1" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("s3cret");
    }
  });
  it("로그는 허용 필드만 출력해 연결 문자열 같은 값이 새지 않는다", () => {
    const out = sanitize({ event: "x", databaseUrl: "postgres://user:pw@h/db", password: "p" } as never);
    expect(JSON.stringify(out)).not.toContain("pw");
    expect(out).toEqual({ event: "x" });
  });
});