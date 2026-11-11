import { sourceErrorMessage } from "./error-messages";

// A-03 GET(프로젝트 상세 + 자료 목록) · A-04 DELETE(자료 소프트 삭제) · A-07 GET(자료 메타·원문 청크).
// 소유·삭제 판정은 RLS(읽기)와 RPC(get_source_chunks·delete_sources)가 하고, 여기서는 입력 검증과 응답 매핑만 한다.

export const CHUNK_DEFAULT_LIMIT = 50;
export const CHUNK_MAX_LIMIT = 100;
export const DELETE_MAX_IDS = 100;

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  summary: string | null;
  suggested_questions: unknown;
  created_at: string;
  updated_at: string;
}

export interface LatestJobRow {
  id: string;
  status: string;
  retryable: boolean;
}

export interface SourceRow {
  id: string;
  project_id: string;
  source_type: string;
  title: string;
  status: string;
  error_code: string | null;
  unavailable_at: string | null;
  original_url: string | null;
  video_id: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkPage {
  chunks: Array<{ id: string; chunk_index: number; content: string; locator: Record<string, unknown> }>;
  has_more: boolean;
  has_before: boolean;
  around: "found" | "not_found" | null;
  unavailable: boolean;
}

export type ChunksResult = { ok: true; page: ChunkPage } | { ok: false; kind: "unauthorized" | "not_found" | "not_ready" | "invalid" | "unknown" };
export type DeleteResult = { ok: true; deleted: number } | { ok: false; kind: "unauthorized" | "not_found" | "invalid" | "unknown" };

export interface SourceReadBackend {
  getUserId(): Promise<string | null>;
  /** RLS로 보이는 프로젝트와 자료(자료별 최신 작업 포함). 프로젝트가 없거나 삭제·타인 것이면 null */
  getProjectDetail(projectId: string): Promise<{ project: ProjectRow; sources: Array<SourceRow & { latest_job: LatestJobRow | null }> } | null>;
  /** RLS로 보이는 자료. 없으면 null */
  getSource(sourceId: string): Promise<SourceRow | null>;
  getChunks(input: { sourceId: string; afterIndex: number | null; limit: number; aroundChunkId: string | null }): Promise<ChunksResult>;
  deleteSources(projectId: string, sourceIds: string[]): Promise<DeleteResult>;
}

export interface SourceReadDeps {
  backend: SourceReadBackend;
  /** Origin 검사 기준(쓰기 요청). 없으면 검사를 건너뛴다. */
  siteUrl?: string | undefined;
}

export const SOURCE_READ_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  projectNotFound: "프로젝트를 찾을 수 없습니다.",
  sourceNotFound: "자료를 찾을 수 없습니다.",
  notReady: "아직 처리가 끝나지 않은 자료입니다. 처리가 끝난 뒤 다시 열어 주세요.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INDEX = /^(0|[1-9]\d{0,8})$/;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const unauthorized = () => fail(401, "unauthorized", SOURCE_READ_MESSAGES.unauthorized);
const badRequest = () => fail(400, "bad_request", SOURCE_READ_MESSAGES.invalidRequest);
const projectNotFound = () => fail(404, "not_found", SOURCE_READ_MESSAGES.projectNotFound);
const sourceNotFound = () => fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
const serverError = () => fail(500, "server_error", SOURCE_READ_MESSAGES.server);

function toSource(row: SourceRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    source_type: row.source_type,
    title: row.title,
    status: row.status,
    error_code: row.error_code,
    error_message: sourceErrorMessage(row.error_code),
    unavailable_at: row.unavailable_at,
    original_url: row.original_url,
    video_id: row.video_id,
    channel_title: row.channel_title,
    duration_seconds: row.duration_seconds,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.archived_at ? ("archived" as const) : ("active" as const),
    summary: row.summary,
    suggested_questions: Array.isArray(row.suggested_questions)
      ? row.suggested_questions.filter((q): q is string => typeof q === "string")
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseChunkQuery(params: URLSearchParams) {
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? CHUNK_DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > CHUNK_MAX_LIMIT) return null;
  const cursor = params.get("cursor");
  if (cursor !== null && !INDEX.test(cursor)) return null;
  const chunkId = params.get("chunk_id");
  if (cursor !== null && chunkId !== null) return null;
  return { limit, afterIndex: cursor === null ? null : Number(cursor), chunkId };
}

export function createSourceReadHandlers(deps: SourceReadDeps) {
  const { backend } = deps;

  async function run(fn: () => Promise<Response>) {
    try {
      return await fn();
    } catch {
      return serverError();
    }
  }

  return {
    /** A-03 GET */
    projectDetail: (_request: Request, projectId: string) =>
      run(async () => {
        if (!(await backend.getUserId())) return unauthorized();
        if (!UUID.test(projectId)) return projectNotFound();
        const detail = await backend.getProjectDetail(projectId);
        if (!detail) return projectNotFound();
        return json(200, {
          project: toProject(detail.project),
          sources: detail.sources.map((s) => ({
            ...toSource(s),
            latest_job: s.latest_job ? { id: s.latest_job.id, status: s.latest_job.status, retryable: s.latest_job.retryable } : null,
          })),
        });
      }),

    /** A-07 GET 자료 메타(상태와 무관하게 준다. 청크는 completed만) */
    source: (_request: Request, sourceId: string) =>
      run(async () => {
        if (!(await backend.getUserId())) return unauthorized();
        if (!UUID.test(sourceId)) return sourceNotFound();
        const row = await backend.getSource(sourceId);
        return row ? json(200, { source: toSource(row) }) : sourceNotFound();
      }),

    /** A-07 GET 원문 청크: ?cursor=<마지막 chunk_index>&limit=1..100 또는 ?chunk_id=<uuid>(그 청크 앞뒤 창) */
    chunks: (request: Request, sourceId: string) =>
      run(async () => {
        if (!(await backend.getUserId())) return unauthorized();
        if (!UUID.test(sourceId)) return sourceNotFound();
        const query = parseChunkQuery(new URL(request.url).searchParams);
        if (!query) return badRequest();
        // 형식이 틀린 chunk_id는 없는 청크와 같게 처음부터 보여 준다
        const validChunkId = query.chunkId !== null && UUID.test(query.chunkId) ? query.chunkId : null;
        const result = await backend.getChunks({ sourceId, afterIndex: query.afterIndex, limit: query.limit, aroundChunkId: validChunkId });
        if (!result.ok) {
          if (result.kind === "unauthorized") return unauthorized();
          if (result.kind === "not_found") return sourceNotFound();
          if (result.kind === "not_ready") return fail(409, "source_not_ready", SOURCE_READ_MESSAGES.notReady);
          if (result.kind === "invalid") return badRequest();
          return serverError();
        }
        const { page } = result;
        const last = page.chunks.at(-1);
        return json(200, {
          items: page.chunks.map((c) => ({ id: c.id, chunk_index: c.chunk_index, content: c.content, locator: c.locator })),
          next_cursor: page.has_more && last ? String(last.chunk_index) : null,
          has_before: page.has_before,
          around: query.chunkId !== null && validChunkId === null ? "not_found" : page.around,
          unavailable: page.unavailable,
        });
      }),

    /** A-04 DELETE: 본문 {"source_ids": [uuid, ...]}(1~100개). 하나라도 없으면 전체 404 */
    deleteSources: (request: Request, projectId: string) =>
      run(async () => {
        const origin = request.headers.get("origin");
        if (origin && deps.siteUrl && origin !== new URL(deps.siteUrl).origin) return badRequest();
        if (!(await backend.getUserId())) return unauthorized();
        if (!UUID.test(projectId)) return projectNotFound();
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return badRequest();
        const text = await request.text();
        if (text.length > 16_384) return badRequest();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return badRequest();
        }
        const ids = (body as { source_ids?: unknown } | null)?.source_ids;
        if (
          !Array.isArray(ids) ||
          ids.length < 1 ||
          ids.length > DELETE_MAX_IDS ||
          !ids.every((id): id is string => typeof id === "string" && UUID.test(id))
        ) {
          return badRequest();
        }
        const result = await backend.deleteSources(projectId, ids);
        if (result.ok) return json(200, { ok: true, deleted: result.deleted });
        if (result.kind === "unauthorized") return unauthorized();
        // 프로젝트·자료 중 무엇이 없는지 알리지 않는다
        if (result.kind === "not_found") return sourceNotFound();
        if (result.kind === "invalid") return badRequest();
        return serverError();
      }),
  };
}
