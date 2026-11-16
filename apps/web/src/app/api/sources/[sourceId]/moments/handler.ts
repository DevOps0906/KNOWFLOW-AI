import { overlappingChunks } from "citations";
import type { MomentItem, MomentsResponse, SummarySentence } from "@/components/youtube/embed";
import { SOURCE_READ_MESSAGES, type ChunkPage, type SourceReadBackend } from "@/lib/sources/handlers";

// A-07 GET /api/sources/:id/moments(task-029b): 장면 카드(L0)·영상 요약.
// 소유·삭제·비활성 판정은 RLS(sources·source_moments·source_summaries)가 하고, 여기서 비활성 자료를 한 번 더 막는다.
// 리포트 인용 가능 여부는 장면 구간과 겹치는 청크가 있는지(packages/citations overlappingChunks)로 정한다.

export interface MomentRow {
  id: string;
  moment_index: number;
  locator: unknown;
  title: string;
  description: string;
}

export interface MomentsBackend extends Pick<SourceReadBackend, "getUserId" | "getSource" | "getChunks"> {
  /** RLS로 보이는 그 자료의 장면 카드(moment_index 순) */
  listMoments(sourceId: string): Promise<MomentRow[]>;
  /** RLS로 보이는 그 자료의 요약 sentences(jsonb). 없으면 null */
  getSummarySentences(sourceId: string): Promise<unknown>;
}

export interface MomentsDeps {
  backend: MomentsBackend;
  /** 유튜브 기능 플래그(서버 설정). 꺼지면 DB를 읽지 않고 {enabled:false} */
  enabled: () => boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const CHUNK_PAGE_LIMIT = 100;
/** replace_source_chunks 상한(20000) / 쪽 크기 */
const CHUNK_MAX_PAGES = 200;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const unauthorized = () => fail(401, "unauthorized", SOURCE_READ_MESSAGES.unauthorized);
const sourceNotFound = () => fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
const serverError = () => fail(500, "server_error", SOURCE_READ_MESSAGES.server);

const EMPTY: MomentsResponse = { enabled: true, unavailable: false, items: [], summary: null };
const UNAVAILABLE: MomentsResponse = { enabled: true, unavailable: true, items: [], summary: null };

type Chunk = ChunkPage["chunks"][number];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 그 자료의 청크 전부(id·locator). 비활성·미완료로 바뀌었으면 그 사유 */
async function loadAllChunks(backend: MomentsBackend, sourceId: string): Promise<Chunk[] | "unavailable" | "not_ready"> {
  const all: Chunk[] = [];
  let after: number | null = null;
  for (let i = 0; i < CHUNK_MAX_PAGES; i++) {
    const result = await backend.getChunks({ sourceId, afterIndex: after, limit: CHUNK_PAGE_LIMIT, aroundChunkId: null });
    if (!result.ok) {
      if (result.kind === "not_ready") return "not_ready";
      throw new Error(`chunks_${result.kind}`);
    }
    if (result.page.unavailable) return "unavailable";
    all.push(...result.page.chunks);
    const last = result.page.chunks.at(-1);
    if (!result.page.has_more || !last) return all;
    after = last.chunk_index;
  }
  return all;
}

function toItem(row: MomentRow, chunks: Chunk[]): MomentItem | null {
  const loc = (row.locator ?? {}) as Record<string, unknown>;
  const tStart = num(loc.t_start);
  const tEnd = num(loc.t_end);
  if (tStart === null || tEnd === null || tEnd <= tStart) return null;
  const locator = { t_start: tStart, t_end: tEnd };
  return {
    id: row.id,
    moment_index: row.moment_index,
    locator,
    title: row.title,
    description: row.description,
    citable: overlappingChunks(locator, chunks).length > 0,
  };
}

/** 저장된 요약(비신뢰 jsonb)을 지금 있는 청크 인용만 남겨 변환한다. 인용이 0건이 된 문장은 버린다 */
function toSummary(raw: unknown, chunks: Chunk[]): { sentences: SummarySentence[] } | null {
  if (!Array.isArray(raw)) return null;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const sentences: SummarySentence[] = [];
  for (const entry of raw) {
    const { text, chunk_ids: ids } = (entry ?? {}) as { text?: unknown; chunk_ids?: unknown };
    if (typeof text !== "string" || !text.trim() || !Array.isArray(ids)) continue;
    const citations = ids
      .filter((id): id is string => typeof id === "string" && byId.has(id))
      .map((id) => ({ chunk_id: id, t_start: num(byId.get(id)?.locator.t_start) }));
    if (citations.length > 0) sentences.push({ text, citations });
  }
  return sentences.length > 0 ? { sentences } : null;
}

export function createMomentsHandler(deps: MomentsDeps) {
  const { backend } = deps;
  return async (_request: Request, sourceId: string): Promise<Response> => {
    try {
      if (!(await backend.getUserId())) return unauthorized();
      if (!deps.enabled()) return json(200, { enabled: false } satisfies MomentsResponse);
      if (!UUID.test(sourceId)) return sourceNotFound();
      const source = await backend.getSource(sourceId);
      if (!source) return sourceNotFound();
      // 비활성 자료는 장면 0건과 구분해 unavailable만 준다(RLS도 숨기지만 여기서 한 번 더)
      if (source.unavailable_at) return json(200, UNAVAILABLE);
      if (source.source_type !== "youtube" || source.status !== "completed") return json(200, EMPTY);

      const [moments, rawSummary] = await Promise.all([backend.listMoments(sourceId), backend.getSummarySentences(sourceId)]);
      if (moments.length === 0 && rawSummary === null) return json(200, EMPTY);

      const chunks = await loadAllChunks(backend, sourceId);
      if (chunks === "unavailable") return json(200, UNAVAILABLE);
      if (chunks === "not_ready") return json(200, EMPTY);

      const items = moments.map((m) => toItem(m, chunks)).filter((m): m is MomentItem => m !== null);
      return json(200, { enabled: true, unavailable: false, items, summary: toSummary(rawSummary, chunks) } satisfies MomentsResponse);
    } catch {
      return serverError();
    }
  };
}
