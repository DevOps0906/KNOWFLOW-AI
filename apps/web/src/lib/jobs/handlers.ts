import { createHash } from "node:crypto";

// A-05: 작업 목록(GET)과 재시도(POST). 재시도 자격·한도의 판단은 retry_source RPC가 하고, 여기서는 입력 검증과 응답 매핑만 한다.

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export interface JobRow {
  id: string;
  job_type: string;
  status: JobStatus;
  current_step: string | null;
  progress: number;
  attempt_count: number;
  error_code: string | null;
  retryable: boolean;
  source_id: string | null;
  source_status: string | null;
  report_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobCursor {
  createdAt: string;
  id: string;
}

export type ListKind = "unauthorized" | "not_found" | "invalid" | "unknown";
export type RetryKind =
  | "unauthorized"
  | "not_found"
  | "completed"
  | "not_retryable"
  | "conflict"
  | "retry_limit"
  | "quota"
  | "rate_limited"
  | "unknown";

export type ListResult = { ok: true; rows: JobRow[] } | { ok: false; kind: ListKind };
export type RetryResult = { ok: true; jobId: string; duplicate: boolean } | { ok: false; kind: RetryKind; retryAfter?: number };

export interface JobsBackend {
  getUserId(): Promise<string | null>;
  list(input: { projectId: string; status: JobStatus | null; cursor: JobCursor | null; limit: number }): Promise<ListResult>;
  retry(input: { sourceId: string; idempotencyKey: string; requestHash: string }): Promise<RetryResult>;
}

export interface JobsDeps {
  backend: JobsBackend;
  /** Origin 검사 기준(쓰기 요청). 없으면 검사를 건너뛴다. */
  siteUrl?: string | undefined;
}

export const JOB_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  projectNotFound: "프로젝트를 찾을 수 없습니다.",
  sourceNotFound: "자료를 찾을 수 없습니다.",
  completed: "이미 처리가 끝난 자료는 다시 시도할 수 없습니다.",
  notRetryable: "이 자료는 다시 시도해도 처리할 수 없습니다. 원인을 확인해 주세요.",
  conflict: "진행 중인 작업이 있거나 같은 요청이 다른 입력으로 들어왔습니다.",
  retryLimit: "이 자료의 재시도 횟수를 모두 사용했습니다.",
  quota: "이번 달 처리 한도에 도달했습니다.",
  rateLimited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
const fail = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  json(status, { error: { code, message } }, headers);

const RETRY_FAILURE: Record<RetryKind, { status: number; code: string; message: string }> = {
  unauthorized: { status: 401, code: "unauthorized", message: JOB_MESSAGES.unauthorized },
  not_found: { status: 404, code: "not_found", message: JOB_MESSAGES.sourceNotFound },
  completed: { status: 422, code: "source_completed", message: JOB_MESSAGES.completed },
  not_retryable: { status: 422, code: "not_retryable", message: JOB_MESSAGES.notRetryable },
  conflict: { status: 409, code: "conflict", message: JOB_MESSAGES.conflict },
  retry_limit: { status: 429, code: "retry_limit_exceeded", message: JOB_MESSAGES.retryLimit },
  quota: { status: 429, code: "quota_exceeded", message: JOB_MESSAGES.quota },
  rate_limited: { status: 429, code: "rate_limited", message: JOB_MESSAGES.rateLimited },
  unknown: { status: 500, code: "server_error", message: JOB_MESSAGES.server },
};

export function encodeJobCursor(cursor: JobCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id }), "utf8").toString("base64url");
}

export function decodeJobCursor(raw: string): JobCursor | null {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { c?: unknown; i?: unknown } | null;
    if (typeof value?.c !== "string" || typeof value.i !== "string") return null;
    return TIMESTAMP.test(value.c) && UUID.test(value.i) ? { createdAt: value.c, id: value.i } : null;
  } catch {
    return null;
  }
}

interface RpcError {
  code?: string;
  message?: string;
  details?: string | null;
}

export function classifyListError(error: RpcError): ListKind {
  switch (error.code) {
    case "28000":
      return "unauthorized";
    case "P0002":
      return "not_found";
    case "22023": // 함수의 입력 검사
    case "22007": // 형식은 맞지만 없는 날짜(커서)
    case "22008":
      return "invalid";
    default:
      return "unknown";
  }
}

function retryAfterFromDetails(details: string | null | undefined): number | undefined {
  return details && /^[1-9]\d{0,7}$/.test(details) ? Number(details) : undefined;
}

export function classifyRetryError(error: RpcError): Exclude<RetryResult, { ok: true }> {
  switch (error.code) {
    case "28000":
      return { ok: false, kind: "unauthorized" };
    case "P0002":
      return { ok: false, kind: "not_found" };
    case "22023": // 멱등 키는 라우트가 먼저 검증하므로 여기까지 오면 completed 자료뿐이다
      return { ok: false, kind: "completed" };
    case "KF422":
      return { ok: false, kind: "not_retryable" };
    case "KF409":
    case "KF410":
      return { ok: false, kind: "conflict" };
    case "KF429": {
      // 영구 한도는 기다려도 풀리지 않으므로 Retry-After를 주지 않는다
      if (error.message === "retry_limit_exceeded") return { ok: false, kind: "retry_limit" };
      const retryAfter = retryAfterFromDetails(error.details);
      const kind = error.message === "retry_rate_limited" ? "rate_limited" : "quota";
      return retryAfter === undefined ? { ok: false, kind } : { ok: false, kind, retryAfter };
    }
    default:
      return { ok: false, kind: "unknown" };
  }
}

function toItem(row: JobRow) {
  return {
    id: row.id,
    job_type: row.job_type,
    status: row.status,
    step: row.current_step,
    progress: row.progress,
    attempt_count: row.attempt_count,
    error_code: row.error_code,
    retryable: row.retryable,
    source_id: row.source_id,
    source: row.source_id ? { status: row.source_status } : null,
    report_id: row.report_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function parseListQuery(params: URLSearchParams) {
  const statusRaw = params.get("status");
  if (statusRaw !== null && !(JOB_STATUSES as readonly string[]).includes(statusRaw)) return null;
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return null;
  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? null : decodeJobCursor(cursorRaw);
  if (cursorRaw !== null && cursor === null) return null;
  return { status: statusRaw as JobStatus | null, limit, cursor };
}

export function createJobHandlers(deps: JobsDeps) {
  const { backend } = deps;

  async function run(fn: () => Promise<Response>) {
    try {
      return await fn();
    } catch {
      return fail(500, "server_error", JOB_MESSAGES.server);
    }
  }

  return {
    list: (request: Request, projectId: string) =>
      run(async () => {
        if (!(await backend.getUserId())) return fail(401, "unauthorized", JOB_MESSAGES.unauthorized);
        if (!UUID.test(projectId)) return fail(404, "not_found", JOB_MESSAGES.projectNotFound);
        const query = parseListQuery(new URL(request.url).searchParams);
        if (!query) return fail(400, "bad_request", JOB_MESSAGES.invalidRequest);

        const result = await backend.list({ projectId, ...query, limit: query.limit + 1 });
        if (!result.ok) {
          if (result.kind === "unauthorized") return fail(401, "unauthorized", JOB_MESSAGES.unauthorized);
          if (result.kind === "not_found") return fail(404, "not_found", JOB_MESSAGES.projectNotFound);
          if (result.kind === "invalid") return fail(400, "bad_request", JOB_MESSAGES.invalidRequest);
          return fail(500, "server_error", JOB_MESSAGES.server);
        }
        const page = result.rows.slice(0, query.limit);
        const last = page.at(-1);
        return json(200, {
          items: page.map(toItem),
          next_cursor: result.rows.length > query.limit && last ? encodeJobCursor({ createdAt: last.created_at, id: last.id }) : null,
        });
      }),

    retry: (request: Request, sourceId: string) =>
      run(async () => {
        const origin = request.headers.get("origin");
        if (origin && deps.siteUrl && origin !== new URL(deps.siteUrl).origin) {
          return fail(400, "bad_request", JOB_MESSAGES.invalidRequest);
        }
        if (!(await backend.getUserId())) return fail(401, "unauthorized", JOB_MESSAGES.unauthorized);
        if (!UUID.test(sourceId)) return fail(404, "not_found", JOB_MESSAGES.sourceNotFound);
        // 키 형식을 먼저 걸러, RPC의 22023이 completed 자료만 뜻하게 한다
        const key = request.headers.get("idempotency-key");
        if (key === null || !KEY.test(key)) return fail(400, "bad_request", JOB_MESSAGES.invalidRequest);

        const requestHash = createHash("sha256").update(JSON.stringify(["retry", sourceId.toLowerCase()])).digest("hex");
        const result = await backend.retry({ sourceId, idempotencyKey: key, requestHash });
        if (result.ok) return json(202, { job_id: result.jobId, duplicate: result.duplicate });
        const failure = RETRY_FAILURE[result.kind];
        return fail(
          failure.status,
          failure.code,
          failure.message,
          result.retryAfter === undefined ? undefined : { "Retry-After": String(result.retryAfter) },
        );
      }),
  };
}
