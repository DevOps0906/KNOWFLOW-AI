import type { Logger } from "./log.js";
import type { Job, JobQueue } from "./queue.js";

/** 다시 시도해도 소용없는 실패(입력 문제 등). 즉시 최종 실패로 닫는다. */
export class PermanentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PermanentError";
  }
}

export interface HandlerContext {
  job: Job;
  /** 임대를 잃으면(다른 Worker가 가져감) 중단된다. 핸들러는 이 신호를 존중해야 한다. */
  signal: AbortSignal;
  progress(step: string, percent: number): Promise<void>;
}

export type Handler = (ctx: HandlerContext) => Promise<void>;
export type Handlers = Partial<Record<Job["job_type"], Handler>>;

export interface RunnerDeps {
  queue: JobQueue;
  handlers: Handlers;
  leaseSeconds: number;
  heartbeatSeconds: number;
  log: Logger;
}

export type RunOutcome = "idle" | "succeeded" | "requeued" | "failed" | "stale";

/** 작업 하나를 가져와 처리한다. 가져올 작업이 없으면 idle. */
export async function runOnce(deps: RunnerDeps): Promise<RunOutcome> {
  const { queue, log } = deps;
  const job = await queue.claim(deps.leaseSeconds);
  if (!job) return "idle";
  const attempt = job.attempt_count;
  const base = { jobId: job.id, jobType: job.job_type, attempt };
  log({ event: "job_claimed", ...base });

  const lost = new AbortController();
  const heartbeat = setInterval(() => {
    queue
      .heartbeat(job.id, attempt, deps.leaseSeconds)
      .then((ok) => {
        if (!ok && !lost.signal.aborted) {
          log({ event: "lease_lost", ...base });
          lost.abort();
        }
      })
      .catch(() => log({ event: "heartbeat_error", ...base }));
  }, deps.heartbeatSeconds * 1000);

  try {
    const handler = deps.handlers[job.job_type];
    if (!handler) {
      const result = await queue.fail(job.id, attempt, "no_handler", false);
      log({ event: "job_finished", ...base, outcome: result, reason: "no_handler" });
      return result;
    }
    try {
      await handler({
        job,
        signal: lost.signal,
        progress: async (step, percent) => {
          const ok = await queue.progress(job.id, attempt, step, Math.min(99, Math.max(0, Math.round(percent))));
          if (!ok) lost.abort();
        },
      });
    } catch (e) {
      if (lost.signal.aborted) {
        log({ event: "job_finished", ...base, outcome: "stale", reason: "lease_lost" });
        return "stale";
      }
      const permanent = e instanceof PermanentError;
      const code = permanent ? e.code : "handler_error";
      const result = await queue.fail(job.id, attempt, code, !permanent);
      log({ event: "job_finished", ...base, outcome: result, reason: code, errorName: e instanceof Error ? e.name : "unknown" });
      return result;
    }
    if (lost.signal.aborted) {
      log({ event: "job_finished", ...base, outcome: "stale", reason: "lease_lost" });
      return "stale";
    }
    // 완료는 현재 시도의 소유자만 할 수 있다. false면 다른 시도가 가져갔으므로 결과를 버린다.
    const done = await queue.complete(job.id, attempt);
    const outcome: RunOutcome = done ? "succeeded" : "stale";
    log({ event: "job_finished", ...base, outcome });
    return outcome;
  } finally {
    clearInterval(heartbeat);
  }
}