import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { sanitize } from "./log.js";
import type { FailResult, Job, JobQueue } from "./queue.js";
import { PermanentError, runOnce, type Handlers } from "./runner.js";

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

  it("진행률은 0~99로 제한해 전달한다", async () => {
    const q = fakeQueue();
    await run(q, { source_ingest: async ({ progress }) => { await progress("x", 250); await progress("y", -5); } });
    expect(q.progress).toHaveBeenNthCalledWith(1, "j1", 2, "x", 99);
    expect(q.progress).toHaveBeenNthCalledWith(2, "j1", 2, "y", 0);
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
  it("로그는 허용 필드만 출력해 연결 문자열 같은 값이 새지 않는다", () => {
    const out = sanitize({ event: "x", databaseUrl: "postgres://user:pw@h/db", password: "p" } as never);
    expect(JSON.stringify(out)).not.toContain("pw");
    expect(out).toEqual({ event: "x" });
  });
});