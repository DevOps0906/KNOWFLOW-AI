// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERIC_SOURCE_ERROR, SOURCE_ERROR_MESSAGES, sourceErrorMessage } from "./error-messages";
import { createSourceReadHandlers, type ChunkPage, type SourceReadBackend, type SourceRow } from "./handlers";
import { createSupabaseSourceReadBackend } from "./queries";

const SITE = "https://app.example.test";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";
const CHUNK = "55555555-5555-4555-8555-555555555555";

const sourceRow = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: SOURCE,
  project_id: PROJECT,
  source_type: "youtube",
  title: "영상",
  status: "failed",
  error_code: "youtube_disabled",
  unavailable_at: "2026-11-12T00:00:00+00:00",
  original_url: "https://www.youtube.com/watch?v=abcdefghijk",
  video_id: "abcdefghijk",
  channel_title: "채널",
  duration_seconds: 600,
  created_at: "2026-11-11T00:00:00+00:00",
  updated_at: "2026-11-11T00:00:00+00:00",
  ...over,
});

const page = (over: Partial<ChunkPage> = {}): ChunkPage => ({
  chunks: [
    { id: CHUNK, chunk_index: 3, content: "<script>alert(1)</script>", locator: { page: 1 } },
    { id: JOB, chunk_index: 4, content: "본문", locator: { t_start: 12 } },
  ],
  has_more: true,
  has_before: true,
  around: null,
  unavailable: false,
  ...over,
});

function setup(overrides: Partial<SourceReadBackend> = {}) {
  const backend: SourceReadBackend = {
    getUserId: vi.fn(async () => USER),
    getProjectDetail: vi.fn(async () => ({
      project: {
        id: PROJECT,
        name: "프로젝트",
        description: null,
        archived_at: null,
        summary: "요약",
        suggested_questions: ["질문 1", 3, "질문 2"],
        created_at: "2026-11-01T00:00:00+00:00",
        updated_at: "2026-11-02T00:00:00+00:00",
      },
      sources: [{ ...sourceRow(), latest_job: { id: JOB, status: "failed", retryable: false } }],
    })),
    getSource: vi.fn(async () => sourceRow()),
    getChunks: vi.fn(async () => ({ ok: true as const, page: page() })),
    deleteSources: vi.fn(async () => ({ ok: true as const, deleted: 2 })),
    ...overrides,
  };
  return { backend, handlers: createSourceReadHandlers({ backend, siteUrl: SITE }) };
}

const get = (path: string) => new Request(`${SITE}${path}`);
const del = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  new Request(`${SITE}/api/projects/${PROJECT}/sources`, { method: "DELETE", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe("A-03 GET 프로젝트 상세", () => {
  it("프로젝트·요약·추천 질문과 자료(unavailable_at·최신 작업 retryable·오류 문구)를 준다", async () => {
    const { handlers } = setup();
    const res = await handlers.projectDetail(get(`/api/projects/${PROJECT}`), PROJECT);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { project: Record<string, unknown>; sources: Array<Record<string, unknown>> };
    expect(body.project).toMatchObject({ id: PROJECT, status: "active", summary: "요약", suggested_questions: ["질문 1", "질문 2"] });
    expect(body.sources[0]).toMatchObject({
      id: SOURCE,
      source_type: "youtube",
      unavailable_at: "2026-11-12T00:00:00+00:00",
      error_code: "youtube_disabled",
      error_message: "유튜브 기능 준비 중",
      latest_job: { id: JOB, status: "failed", retryable: false },
    });
  });

  it("작업이 없는 자료는 latest_job null, 오류 코드가 없으면 error_message null", async () => {
    const { handlers } = setup({
      getProjectDetail: vi.fn(async () => ({
        project: { id: PROJECT, name: "p", description: null, archived_at: "2026-11-03T00:00:00+00:00", summary: null, suggested_questions: null, created_at: "x", updated_at: "x" },
        sources: [{ ...sourceRow({ error_code: null, status: "completed" }), latest_job: null }],
      })),
    });
    const body = (await (await handlers.projectDetail(get("/"), PROJECT)).json()) as { project: Record<string, unknown>; sources: Array<Record<string, unknown>> };
    expect(body.project).toMatchObject({ status: "archived", suggested_questions: [] });
    expect(body.sources[0]).toMatchObject({ latest_job: null, error_message: null });
  });

  it("없는·삭제된·타인 프로젝트(null)와 잘못된 id는 404, 세션 없으면 401", async () => {
    expect((await setup({ getProjectDetail: vi.fn(async () => null) }).handlers.projectDetail(get("/"), PROJECT)).status).toBe(404);
    const { handlers, backend } = setup();
    expect((await handlers.projectDetail(get("/"), "nope")).status).toBe(404);
    expect(backend.getProjectDetail).not.toHaveBeenCalled();
    expect((await setup({ getUserId: vi.fn(async () => null) }).handlers.projectDetail(get("/"), PROJECT)).status).toBe(401);
  });

  it("DB 오류는 내부 정보 없이 500", async () => {
    const { handlers } = setup({ getProjectDetail: vi.fn(async () => Promise.reject(new Error("relation does not exist"))) });
    const res = await handlers.projectDetail(get("/"), PROJECT);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/relation|sql|postgres/i);
  });
});

describe("A-07 GET 자료 메타", () => {
  it("메타를 주고, 없으면 404", async () => {
    const { handlers } = setup();
    const body = (await (await handlers.source(get("/"), SOURCE)).json()) as { source: Record<string, unknown> };
    expect(body.source).toMatchObject({ id: SOURCE, video_id: "abcdefghijk", channel_title: "채널", unavailable_at: "2026-11-12T00:00:00+00:00" });
    expect((await setup({ getSource: vi.fn(async () => null) }).handlers.source(get("/"), SOURCE)).status).toBe(404);
    expect((await handlers.source(get("/"), "x")).status).toBe(404);
  });
});

describe("A-07 GET 원문 청크", () => {
  const url = (qs = "") => get(`/api/sources/${SOURCE}/chunks${qs}`);

  it("청크와 다음 커서(마지막 chunk_index)를 준다", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.chunks(url("?limit=2&cursor=2"), SOURCE);
    expect(res.status).toBe(200);
    expect(backend.getChunks).toHaveBeenCalledWith({ sourceId: SOURCE, afterIndex: 2, limit: 2, aroundChunkId: null });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      items: page().chunks,
      next_cursor: "4",
      has_before: true,
      around: null,
      unavailable: false,
    });
  });

  it("chunk_id는 그대로 넘기고, 형식이 틀리면 넘기지 않고 not_found로 처음부터", async () => {
    const { handlers, backend } = setup({ getChunks: vi.fn(async () => ({ ok: true as const, page: page({ around: "found", has_more: false }) })) });
    const found = (await (await handlers.chunks(url(`?chunk_id=${CHUNK}`), SOURCE)).json()) as Record<string, unknown>;
    expect(backend.getChunks).toHaveBeenLastCalledWith({ sourceId: SOURCE, afterIndex: null, limit: 50, aroundChunkId: CHUNK });
    expect(found).toMatchObject({ around: "found", next_cursor: null });
    const bad = (await (await handlers.chunks(url("?chunk_id=zzz"), SOURCE)).json()) as Record<string, unknown>;
    expect(backend.getChunks).toHaveBeenLastCalledWith({ sourceId: SOURCE, afterIndex: null, limit: 50, aroundChunkId: null });
    expect(bad.around).toBe("not_found");
  });

  it("비활성 자료는 청크 없이 unavailable=true", async () => {
    const empty = page({ chunks: [], has_more: false, has_before: false, unavailable: true });
    const { handlers } = setup({ getChunks: vi.fn(async () => ({ ok: true as const, page: empty })) });
    expect(await (await handlers.chunks(url(), SOURCE)).json()).toEqual({ items: [], next_cursor: null, has_before: false, around: null, unavailable: true });
  });

  it("타인·없는·삭제된 자료 404, 미완료 409", async () => {
    const notFound = setup({ getChunks: vi.fn(async () => ({ ok: false as const, kind: "not_found" as const })) });
    const r404 = await notFound.handlers.chunks(url(), SOURCE);
    expect(r404.status).toBe(404);
    expect(await code(r404)).toBe("not_found");
    const notReady = setup({ getChunks: vi.fn(async () => ({ ok: false as const, kind: "not_ready" as const })) });
    const r409 = await notReady.handlers.chunks(url(), SOURCE);
    expect(r409.status).toBe(409);
    expect(await code(r409)).toBe("source_not_ready");
  });

  it.each(["?limit=0", "?limit=101", "?limit=a", "?cursor=-1", "?cursor=01", `?cursor=1&chunk_id=${CHUNK}`])("잘못된 질의 %s는 400", async (qs) => {
    const { handlers, backend } = setup();
    expect((await handlers.chunks(url(qs), SOURCE)).status).toBe(400);
    expect(backend.getChunks).not.toHaveBeenCalled();
  });
});

describe("A-04 DELETE 자료 소프트 삭제", () => {
  it("source_ids를 넘기고 새로 지운 수를 준다", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.deleteSources(del({ source_ids: [SOURCE, JOB], user_id: "x" }), PROJECT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 2 });
    expect(backend.deleteSources).toHaveBeenCalledWith(PROJECT, [SOURCE, JOB]);
  });

  it("하나라도 없거나 타인 것이면 404", async () => {
    const { handlers } = setup({ deleteSources: vi.fn(async () => ({ ok: false as const, kind: "not_found" as const })) });
    const res = await handlers.deleteSources(del({ source_ids: [SOURCE] }), PROJECT);
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("not_found");
  });

  it.each([
    ["빈 목록", { source_ids: [] }],
    ["uuid 아님", { source_ids: ["x"] }],
    ["배열 아님", { source_ids: SOURCE }],
    ["101개", { source_ids: Array.from({ length: 101 }, () => SOURCE) }],
    ["JSON 아님", "{"],
  ])("%s는 400", async (_name, body) => {
    const { handlers, backend } = setup();
    expect((await handlers.deleteSources(del(body), PROJECT)).status).toBe(400);
    expect(backend.deleteSources).not.toHaveBeenCalled();
  });

  it("다른 Origin·JSON 아닌 본문은 400, 세션 없으면 401, 잘못된 프로젝트 id는 404", async () => {
    const { handlers } = setup();
    expect((await handlers.deleteSources(del({ source_ids: [SOURCE] }, { "Content-Type": "application/json", Origin: "https://evil.test" }), PROJECT)).status).toBe(400);
    expect((await handlers.deleteSources(del({ source_ids: [SOURCE] }, { "Content-Type": "text/plain" }), PROJECT)).status).toBe(400);
    expect((await handlers.deleteSources(del({ source_ids: [SOURCE] }), "x")).status).toBe(404);
    expect((await setup({ getUserId: vi.fn(async () => null) }).handlers.deleteSources(del({ source_ids: [SOURCE] }), PROJECT)).status).toBe(401);
  });
});

/** supabase-js 질의 빌더 흉내: 호출을 기록하고, await하면 테이블별 결과를 준다 */
function fakeSupabase(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const builder = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, method: string) {
          if (method === "then") {
            const result = results[table]!;
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          return (...args: unknown[]) => {
            calls.push({ table, method, args });
            return builder(table);
          };
        },
      },
    );
  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient;
  return { client, calls };
}

describe("A-03·A-07 질의: 삭제된 프로젝트·자료 제외", () => {
  it("프로젝트·자료 모두 deleted_at IS NULL로 읽고, 자료별 최신 작업 1건을 latest_job으로 바꾼다", async () => {
    const { client, calls } = fakeSupabase({
      projects: { data: { id: PROJECT }, error: null },
      sources: { data: [{ ...sourceRow(), processing_jobs: [{ id: JOB, status: "failed", retryable: true, created_at: "x" }] }, { ...sourceRow({ id: CHUNK }), processing_jobs: [] }], error: null },
    });
    const detail = await createSupabaseSourceReadBackend(client).getProjectDetail(PROJECT);
    for (const table of ["projects", "sources"]) {
      expect(calls).toContainEqual({ table, method: "is", args: ["deleted_at", null] });
    }
    expect(calls).toContainEqual({ table: "sources", method: "limit", args: [1, { referencedTable: "processing_jobs" }] });
    expect(detail?.sources.map((s) => s.latest_job)).toEqual([{ id: JOB, status: "failed", retryable: true, created_at: "x" }, null]);
    expect(detail?.sources[0]).not.toHaveProperty("processing_jobs");
  });

  it("최신 작업은 source_ingest만 본다(더 최신 재확인 작업이 있어도 ingest 작업의 retryable)", async () => {
    // 임베드 필터는 PostgREST가 적용하므로, 필터가 걸린 뒤 돌아오는 행(ingest 1건)을 흉내 낸다
    const { client, calls } = fakeSupabase({
      projects: { data: { id: PROJECT }, error: null },
      sources: { data: [{ ...sourceRow(), processing_jobs: [{ id: JOB, status: "failed", retryable: false, created_at: "x" }] }], error: null },
    });
    const detail = await createSupabaseSourceReadBackend(client).getProjectDetail(PROJECT);
    expect(calls).toContainEqual({ table: "sources", method: "eq", args: ["processing_jobs.job_type", "source_ingest"] });
    const embedOrder = calls.findIndex((c) => c.method === "order" && (c.args[1] as { referencedTable?: string })?.referencedTable === "processing_jobs");
    const filter = calls.findIndex((c) => c.method === "eq" && c.args[0] === "processing_jobs.job_type");
    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(embedOrder);
    expect(detail?.sources[0]?.latest_job).toMatchObject({ id: JOB, retryable: false });
  });

  it("프로젝트가 보이지 않으면 null(→404), 자료 메타도 deleted_at IS NULL", async () => {
    const { client, calls } = fakeSupabase({ projects: { data: null, error: null }, sources: { data: null, error: null } });
    const backend = createSupabaseSourceReadBackend(client);
    expect(await backend.getProjectDetail(PROJECT)).toBeNull();
    expect(await backend.getSource(SOURCE)).toBeNull();
    expect(calls.filter((c) => c.table === "sources" && c.method === "is")).toHaveLength(2);
  });
});

describe("자료 오류 문구 표", () => {
  const worker = (rel: string) => readFileSync(new URL(`../../../../worker/src/${rel}`, import.meta.url), "utf8");
  /** `export const NAME = { ... } as const` 블록의 문자열 값들 */
  const constValues = (source: string, name: string) => {
    const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const`).exec(source)?.[1];
    if (!block) throw new Error(`${name} 상수를 찾지 못했습니다`);
    return [...block.matchAll(/:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]!);
  };

  it("Worker 상수 3곳(pdf·ingest·youtube)의 코드를 모두 담는다", () => {
    const codes = [
      ...constValues(worker("pdf/settings.ts"), "PDF_ERROR_CODES"),
      ...constValues(worker("ingest/settings.ts"), "INGEST_ERROR_CODES"),
      ...constValues(worker("youtube/settings.ts"), "YOUTUBE_ERROR_CODES"),
    ];
    expect(codes.length).toBeGreaterThan(25);
    expect(codes.filter((c) => !(c in SOURCE_ERROR_MESSAGES))).toEqual([]);
  });

  it("DB·러너가 남기는 코드(lease_expired·no_handler·unknown·handler_error)를 모두 담는다", () => {
    const dir = new URL("../../../../../supabase/migrations/", import.meta.url);
    const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
    const fromSql = [...sql.matchAll(/error_code = '([a-z0-9_]+)'|sync_source_status\([^;]*?'failed', '([a-z0-9_]+)'\)|else '([a-z0-9_]+)' end/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
    const runner = worker("runner.ts");
    const fromRunner = [...runner.matchAll(/queue\.fail\([^)]*?"([a-z0-9_]+)"|permanent \? e\.code : "([a-z0-9_]+)"/g)].map((m) => m[1] ?? m[2]!);
    const codes = new Set([...fromSql, ...fromRunner, "lease_expired", "no_handler", "unknown", "handler_error"]);
    expect(fromSql).toContain("lease_expired");
    expect(fromRunner).toEqual(expect.arrayContaining(["no_handler", "handler_error"]));
    expect([...codes].filter((c) => !(c in SOURCE_ERROR_MESSAGES))).toEqual([]);
  });

  it("모르는 코드는 일반 문구, 코드가 없으면 null, 문구에 원문 코드가 없다", () => {
    expect(sourceErrorMessage("totally_new_code")).toBe(GENERIC_SOURCE_ERROR);
    expect(sourceErrorMessage("constructor")).toBe(GENERIC_SOURCE_ERROR);
    expect(sourceErrorMessage(null)).toBeNull();
    expect(sourceErrorMessage("youtube_disabled")).toBe("유튜브 기능 준비 중");
    for (const [key, message] of Object.entries(SOURCE_ERROR_MESSAGES)) expect(message).not.toContain(key);
  });
});
