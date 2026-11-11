import { describe, expect, it, vi } from "vitest";
import {
  classifyListError,
  classifyRetryError,
  createJobHandlers,
  decodeJobCursor,
  encodeJobCursor,
  type JobRow,
  type JobsBackend,
} from "./handlers";

const SITE = "https://app.example.test";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";

const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: JOB,
  job_type: "source_ingest",
  status: "failed",
  current_step: "extract",
  progress: 10,
  attempt_count: 3,
  error_code: "timeout",
  retryable: true,
  source_id: SOURCE,
  source_status: "failed",
  report_id: null,
  created_at: "2026-11-11T05:00:00.123456+00:00",
  started_at: null,
  finished_at: null,
  ...over,
});

function setup(overrides: Partial<JobsBackend> = {}) {
  const backend: JobsBackend = {
    getUserId: vi.fn(async () => USER),
    list: vi.fn(async () => ({ ok: true as const, rows: [row()] })),
    retry: vi.fn(async () => ({ ok: true as const, jobId: JOB, duplicate: false })),
    ...overrides,
  };
  return { backend, handlers: createJobHandlers({ backend, siteUrl: SITE }) };
}

const get = (query = "") => new Request(`${SITE}/api/projects/${PROJECT}/jobs${query}`);
const post = (headers: Record<string, string> = { "Idempotency-Key": "key-1" }) =>
  new Request(`${SITE}/api/sources/${SOURCE}/retry`, { method: "POST", headers });
const code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe("A-05 GET 작업 목록", () => {
  it("source.status와 job.status를 분리해 돌려주고, 한 건 더 읽어 다음 커서를 만든다", async () => {
    const LAST = "55555555-5555-4555-8555-555555555555";
    const rows = [row(), row({ id: LAST, created_at: "2026-11-11T04:00:00+00:00" }), row()];
    const { backend, handlers } = setup({ list: vi.fn(async () => ({ ok: true as const, rows })) });
    const res = await handlers.list(get("?limit=2&status=failed"), PROJECT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; next_cursor: string };
    expect(backend.list).toHaveBeenCalledWith({ projectId: PROJECT, status: "failed", cursor: null, limit: 3 });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ status: "failed", source: { status: "failed" }, step: "extract", attempt_count: 3, error_code: "timeout" });
    expect(decodeJobCursor(body.next_cursor)).toEqual({ createdAt: "2026-11-11T04:00:00+00:00", id: LAST });
  });

  it("다음 쪽이 없으면 커서는 null, 리포트 작업은 source가 null", async () => {
    const report = row({ job_type: "report_generate", source_id: null, source_status: null, report_id: JOB });
    const { handlers } = setup({ list: vi.fn(async () => ({ ok: true as const, rows: [report] })) });
    const body = (await (await handlers.list(get(), PROJECT)).json()) as { items: Array<Record<string, unknown>>; next_cursor: unknown };
    expect(body.next_cursor).toBeNull();
    expect(body.items[0]).toMatchObject({ source: null, report_id: JOB });
  });

  it("복합 커서를 그대로 해석해 넘긴다", async () => {
    const cursor = { createdAt: "2026-11-11T05:00:00.123456+00:00", id: JOB };
    const { backend, handlers } = setup();
    await handlers.list(get(`?cursor=${encodeJobCursor(cursor)}`), PROJECT);
    expect(backend.list).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
  });

  it.each(["?status=done", "?limit=0", "?limit=51", "?limit=abc", "?cursor=!!", `?cursor=${Buffer.from('{"c":"x","i":"y"}').toString("base64url")}`])(
    "잘못된 쿼리 %s는 400이고 조회하지 않는다",
    async (query) => {
      const { backend, handlers } = setup();
      expect((await handlers.list(get(query), PROJECT)).status).toBe(400);
      expect(backend.list).not.toHaveBeenCalled();
    },
  );

  it("비로그인 401, 잘못된 id와 타인 프로젝트는 404, 조회 실패 500", async () => {
    expect((await setup({ getUserId: async () => null }).handlers.list(get(), PROJECT)).status).toBe(401);
    expect((await setup().handlers.list(get(), "not-uuid")).status).toBe(404);
    const other = setup({ list: async () => ({ ok: false, kind: "not_found" }) });
    expect((await other.handlers.list(get(), PROJECT)).status).toBe(404);
    expect((await setup({ list: async () => ({ ok: false, kind: "unknown" }) }).handlers.list(get(), PROJECT)).status).toBe(500);
    expect((await setup({ list: async () => { throw new Error("x"); } }).handlers.list(get(), PROJECT)).status).toBe(500);
  });
});

describe("A-05 POST 재시도", () => {
  it("성공하면 202와 새 작업 id, 세션 없는 입력(user_id)은 넘기지 않는다", async () => {
    const { backend, handlers } = setup();
    const res = await handlers.retry(post(), SOURCE);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job_id: JOB, duplicate: false });
    expect(backend.retry).toHaveBeenCalledWith({ sourceId: SOURCE, idempotencyKey: "key-1", requestHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it.each([
    ["없음", {}],
    ["형식 오류", { "Idempotency-Key": "key with space" }],
    ["너무 김", { "Idempotency-Key": "a".repeat(201) }],
  ])("멱등 키 %s는 400이고 RPC를 부르지 않는다", async (_n, headers: Record<string, string>) => {
    const { backend, handlers } = setup();
    const res = await handlers.retry(post(headers), SOURCE);
    expect(res.status).toBe(400);
    expect(backend.retry).not.toHaveBeenCalled();
  });

  it("다른 Origin 400, 비로그인 401, UUID가 아니면 404", async () => {
    expect((await setup().handlers.retry(post({ "Idempotency-Key": "k", origin: "https://evil.test" }), SOURCE)).status).toBe(400);
    expect((await setup({ getUserId: async () => null }).handlers.retry(post(), SOURCE)).status).toBe(401);
    const { backend, handlers } = setup();
    expect((await handlers.retry(post(), "not-uuid")).status).toBe(404);
    expect(backend.retry).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "source_not_found", null, 404, "not_found", null],
    ["KF409", "source_has_active_job", null, 409, "conflict", null],
    ["KF410", "idempotency_resource_missing", null, 409, "conflict", null],
    ["22023", "source_already_completed", null, 422, "source_completed", null],
    ["KF422", "source_not_retryable", null, 422, "not_retryable", null],
    ["KF429", "retry_limit_exceeded", null, 429, "retry_limit_exceeded", null],
    ["KF429", "quota_exceeded", "86400", 429, "quota_exceeded", "86400"],
    ["KF429", "retry_rate_limited", "37", 429, "rate_limited", "37"],
    ["KF429", "retry_rate_limited", "x", 429, "rate_limited", null],
    ["XX000", "boom", null, 500, "server_error", null],
  ])("RPC 오류 %s(%s)는 응답 %i로 매핑한다", async (rpcCode, message, details, status, errorCode, retryAfter) => {
    const { handlers } = setup({ retry: async () => classifyRetryError({ code: rpcCode, message, details }) });
    const res = await handlers.retry(post(), SOURCE);
    expect(res.status).toBe(status);
    expect(await code(res)).toBe(errorCode);
    expect(res.headers.get("Retry-After")).toBe(retryAfter);
  });

  it("목록 오류: 없는 날짜의 커서(22008)는 잘못된 입력", () => {
    expect(classifyListError({ code: "22008" })).toBe("invalid");
    expect(classifyListError({ code: "P0002" })).toBe("not_found");
    expect(classifyListError({ code: "XX000" })).toBe("unknown");
  });
});
