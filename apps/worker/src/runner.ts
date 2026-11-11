import type { Logger } from "./log.js";
import type { Job, JobQueue } from "./queue.js";

/** 다시 시도해도 소용없는 실패(입력 문제 등). 즉시 최종 실패로 닫는다. */
export class PermanentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PermanentError";
  }
}

/** 펜싱된 쓰기가 거부됐다(다른 시도가 작업을 가져감). 실패로 기록하지 않고 결과를 버린다. */
export class StaleAttemptError extends Error {
  constructor() {
    super("stale_attempt");
    this.name = "StaleAttemptError";
  }
}

export interface HandlerContext {
  job: Job;
  /** 임대를 잃으면(다른 Worker가 가져감) 중단된다. 핸들러는 이 신호를 존중해야 한다. */
  signal: AbortSignal;
  progress(step: string, percent: number): Promise<void>;
}

export interface HandlerResult {
  /** 핸들러가 결과 저장과 같은 트랜잭션에서 작업을 이미 완료했다(runner는 complete를 부르지 않는다) */
  completed?: boolean;
  /**
   * 완료 뒤 후행 단계(예: 프로젝트 요약). 실패해도 작업 결과를 바꾸지 않고 로그만 남긴다.
   * 돌려준 문자열은 결과 표시(outcome)로 로그에 남긴다.
   */
  afterComplete?: () => Promise<string | void>;
}

export type Handler = (ctx: HandlerContext) => Promise<void | HandlerResult>;
export type Handlers = Partial<Record<Job["job_type"], Handler>>;

export interface RunnerDeps {
  queue: JobQueue;
  handlers: Handlers;
  leaseSeconds: number;
  heartbeatSeconds: number;
  log: Logger;
}

export type RunOutcome = "idle" | "succeeded" | "requeued" | "failed" | "stale";

/** 일시 오류가 연속 failures번째일 때 다음 폴링까지 기다릴 시간(지수 증가, 상한 있음). */
export function backoffMs(failures: number, baseMs: number, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(failures, 1) - 1, 16));
}

/** 작업 하나를 가져와 처리한다. 가져올 작업이 없으면 idle. */
export async function runOnce(deps: RunnerDeps): Promise<RunOutcome> {
  const { queue, log } = deps;
  const leaseMs = deps.leaseSeconds * 1000;
  // 임대는 DB가 요청을 처리한 시점부터 잰다. 보내기 전 시각을 기준으로 해 로컬 기한이 DB보다 늦지 않게 한다.
  const claimSentAt = Date.now();
  const job = await queue.claim(deps.leaseSeconds);
  if (!job) return "idle";
  const attempt = job.attempt_count;
  const base = { jobId: job.id, jobType: job.job_type, attempt };
  log({ event: "job_claimed", ...base });

  const lost = new AbortController();
  // 하트비트가 오류·지연으로 연장되지 못하면 임대는 이미 끝났을 수 있으므로, 마지막 성공 기준으로 임대 시간을 넘기면 중단한다
  let deadlineAt = claimSentAt + leaseMs;
  let deadlineTimer: NodeJS.Timeout | undefined;
  const armDeadline = () => {
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => {
      if (lost.signal.aborted) return;
      log({ event: "lease_deadline_exceeded", ...base });
      lost.abort();
    }, Math.max(0, deadlineAt - Date.now()));
  };
  armDeadline();
  // finally 뒤에 도착한 하트비트 응답은 끝난 시도의 것이므로 무시한다
  let finished = false;
  const heartbeat = setInterval(() => {
    const sentAt = Date.now();
    queue
      .heartbeat(job.id, attempt, deps.leaseSeconds)
      .then((ok) => {
        if (finished) return;
        if (!ok) {
          if (!lost.signal.aborted) {
            log({ event: "lease_lost", ...base });
            lost.abort();
          }
          return;
        }
        if (!lost.signal.aborted && sentAt + leaseMs > deadlineAt) {
          deadlineAt = sentAt + leaseMs;
          armDeadline();
        }
      })
      .catch(() => {
        if (!finished) log({ event: "heartbeat_error", ...base });
      });
  }, deps.heartbeatSeconds * 1000);
  lost.signal.addEventListener("abort", () => clearInterval(heartbeat), { once: true });

  let after: HandlerResult["afterComplete"];
  let outcome: RunOutcome;
  try {
    const handler = deps.handlers[job.job_type];
    if (!handler) {
      const result = await queue.fail(job.id, attempt, "no_handler", false);
      log({ event: "job_finished", ...base, outcome: result, reason: "no_handler" });
      return result;
    }
    let result: void | HandlerResult;
    try {
      result = await handler({
        job,
        signal: lost.signal,
        progress: async (step, percent) => {
          const ok = await queue.progress(job.id, attempt, step, Math.min(99, Math.max(0, Math.round(percent))));
          if (!ok) lost.abort();
        },
      });
    } catch (e) {
      if (lost.signal.aborted || e instanceof StaleAttemptError) {
        log({ event: "job_finished", ...base, outcome: "stale", reason: lost.signal.aborted ? "lease_lost" : "fenced" });
        return "stale";
      }
      const permanent = e instanceof PermanentError;
      const code = permanent ? e.code : "handler_error";
      const failed = await queue.fail(job.id, attempt, code, !permanent);
      log({ event: "job_finished", ...base, outcome: failed, reason: code, errorName: e instanceof Error ? e.name : "unknown" });
      return failed;
    }
    if (result?.completed) {
      // 핸들러가 펜싱된 트랜잭션으로 이미 완료했다. 그 뒤의 임대 상실 신호는 완료 때문에 생긴 것이다.
      outcome = "succeeded";
    } else if (lost.signal.aborted) {
      log({ event: "job_finished", ...base, outcome: "stale", reason: "lease_lost" });
      return "stale";
    } else {
      // 완료는 현재 시도의 소유자만 할 수 있다. false면 다른 시도가 가져갔으므로 결과를 버린다.
      outcome = (await queue.complete(job.id, attempt)) ? "succeeded" : "stale";
    }
    log({ event: "job_finished", ...base, outcome });
    if (outcome === "succeeded") after = result?.afterComplete;
  } finally {
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(deadlineTimer);
  }

  // 후행 단계는 작업이 끝난 뒤 하트비트 없이 돈다. 실패는 작업 결과를 바꾸지 않는다.
  if (after) {
    try {
      const label = await after();
      log({ event: "after_complete", ...base, outcome: label || "done" });
    } catch (e) {
      log({ event: "after_complete", ...base, outcome: "failed", errorName: e instanceof Error ? e.name : "unknown" });
    }
  }
  return outcome;
}