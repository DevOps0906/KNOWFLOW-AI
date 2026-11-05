// JSON 한 줄 로그. 허용한 필드만 출력한다(연결 문자열·키·작업 본문은 넘기지 않는다).
export interface LogFields {
  event: string;
  jobId?: string;
  jobType?: string;
  attempt?: number;
  outcome?: string;
  reason?: string;
  workerId?: string;
  claimed?: number;
  succeeded?: number;
  failed?: number;
  requeued?: number;
  stale?: number;
  jobsPerMinute?: number;
  windowSeconds?: number;
  errorName?: string;
}

export type Logger = (fields: LogFields) => void;

const ALLOWED = new Set([
  "event", "jobId", "jobType", "attempt", "outcome", "reason", "workerId", "claimed", "succeeded",
  "failed", "requeued", "stale", "jobsPerMinute", "windowSeconds", "errorName",
]);

export function sanitize(fields: LogFields): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "number") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 120);
  }
  return out;
}

export const log: Logger = (fields) => {
  console.info(JSON.stringify({ type: "worker", at: new Date().toISOString(), ...sanitize(fields) }));
};