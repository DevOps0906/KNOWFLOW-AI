import type { Pool } from "pg";

export interface Job {
  id: string;
  user_id: string;
  source_id: string | null;
  report_id: string | null;
  job_type: "source_ingest" | "report_generate" | "source_recheck";
  attempt_count: number;
  max_attempts: number;
}

export type FailResult = "requeued" | "failed" | "stale";

/** 큐 접근 인터페이스. 모든 상태 전이는 (jobId, attempt)로 펜싱되어 오래된 시도의 쓰기는 거부된다. */
export interface JobQueue {
  claim(leaseSeconds: number): Promise<Job | null>;
  heartbeat(jobId: string, attempt: number, leaseSeconds: number): Promise<boolean>;
  progress(jobId: string, attempt: number, step: string, progress: number): Promise<boolean>;
  complete(jobId: string, attempt: number): Promise<boolean>;
  fail(jobId: string, attempt: number, errorCode: string, retryable: boolean): Promise<FailResult>;
}

type Queryable = Pick<Pool, "query">;

export function createPgQueue(db: Queryable): JobQueue {
  return {
    async claim(leaseSeconds) {
      const r = await db.query<{ job: Job | null }>("select public.claim_job($1) as job", [leaseSeconds]);
      return r.rows[0]?.job ?? null;
    },
    async heartbeat(jobId, attempt, leaseSeconds) {
      const r = await db.query<{ ok: boolean }>("select public.heartbeat_job($1, $2, $3) as ok", [jobId, attempt, leaseSeconds]);
      return r.rows[0]?.ok === true;
    },
    async progress(jobId, attempt, step, progress) {
      const r = await db.query<{ ok: boolean }>("select public.progress_job($1, $2, $3, $4) as ok", [jobId, attempt, step, progress]);
      return r.rows[0]?.ok === true;
    },
    async complete(jobId, attempt) {
      const r = await db.query<{ ok: boolean }>("select public.complete_job($1, $2) as ok", [jobId, attempt]);
      return r.rows[0]?.ok === true;
    },
    async fail(jobId, attempt, errorCode, retryable) {
      const r = await db.query<{ result: FailResult }>("select public.fail_job($1, $2, $3, $4) as result", [jobId, attempt, errorCode, retryable]);
      return r.rows[0]!.result;
    },
  };
}