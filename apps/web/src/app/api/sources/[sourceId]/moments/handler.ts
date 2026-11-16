import { overlappingChunks, verifyCitations } from "citations";
import type { ChunksResult, SourceRow } from "@/lib/sources/handlers";

// A-07 GET /api/sources/:id/moments(task-029): 장면 카드(L0) + 영상 요약.
// 소유·삭제·비활성 판정은 RLS(sources·source_moments·source_summaries)와 get_source_chunks RPC가 하고, 여기서는 응답만 만든다.
// 장면 카드의 리포트 인용 가능 여부 = 겹치는 청크가 하나라도 있는가(packages/citations overlappingChunks).
// 요약 문장의 chunk_id는 지금 그 자료의 청크만 인정한다(verifyCitations). 유효 인용 0건 문장은 내보내지 않는다.

/** 청크 위치를 모으는 쪽 크기(get_source_chunks 상한)와 최대 쪽 수 */
export const MOMENT_CHUNK_PAGE = 100;
export const MOMENT_CHUNK_MAX_PAGES = 50;

export interface MomentRow {
  id: string;
  moment_index: number;
  locator: unknown;
  title: string;
  description: string;
}

export interface MomentsBackend {
  getUserId(): Promise<string | null>;
  getSource(sourceId: string): Promise<SourceRow | null>;
  getChunks(input: { sourceId: string; afterIndex: number | null; limit: number; aroundChunkId: null }): Promise<ChunksResult>;
  listMoments(sourceId: string): Promise<MomentRow[]>;
  /** RLS로 보이는 요약 문장(비신뢰 jsonb). 없으면 null */
  getSummarySentences(sourceId: string): Promise<unknown>;
}

export interface MomentsDeps {
  backend: MomentsBackend;
  /** 유튜브 기능 플래그(서버 설정). 꺼지면 {enabled:false} */
  youtubeEnabled: () => boolean;
}

export interface MomentItem {
  id: string;
  moment_index: number;
  locator: { t_start: number; t_end: number };
  title: string;
  description: string;
  /** 겹치는 전사 청크가 있어 리포트에 인용할 수 있는가 */
  citable: boolean;
}

export interface SummarySentenceItem {
  text: string;
  citations: Array<{ chunk_id: string; t_start: number }>;
}

export type MomentsResponse =
  | { enabled: false }
  | { enabled: true; unavailable: true }
  | { enabled: true; unavailable: false; moments: MomentItem[]; summary: SummarySentenceItem[] | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

export const MOMENTS_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  sourceNotFound: "자료를 찾을 수 없습니다.",
  notReady: "아직 처리가 끝나지 않은 자료입니다. 처리가 끝난 뒤 다시 열어 주세요.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
  chunkLimit: "전사가 너무 길어 장면 카드와 요약의 인용을 확인할 수 없습니다.",
} as const;

type TimedChunk = { chunk_id: string; t_start: number; t_end: number };

function timeRange(locator: unknown): { t_start: number; t_end: number } | null {
  if (typeof locator !== "object" || locator === null) return null;
  const { t_start, t_end } = locator as { t_start?: unknown; t_end?: unknown };
  return typeof t_start === "number" && typeof t_end === "number" && Number.isFinite(t_start) && Number.isFinite(t_end) && t_end > t_start
    ? { t_start, t_end }
    : null;
}

/** 저장된 요약 문장을 현재 청크 기준으로 다시 검증한다 */
export function toSummary(raw: unknown, chunks: readonly TimedChunk[]): SummarySentenceItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SummarySentenceItem[] = [];
  for (const item of raw as unknown[]) {
    const s = typeof item === "object" && item !== null ? (item as { text?: unknown; chunk_ids?: unknown }) : null;
    if (!s || typeof s.text !== "string" || !s.text.trim()) continue;
    const { verified } = verifyCitations({ cited: s.chunk_ids, allowedChunks: chunks });
    const byId = new Map(verified.map((c) => [c.chunk_id, { chunk_id: c.chunk_id, t_start: c.t_start }]));
    const citations = [...byId.values()];
    if (citations.length > 0) out.push({ text: s.text, citations });
  }
  return out.length > 0 ? out : null;
}

export function toMoments(rows: readonly MomentRow[], chunks: readonly TimedChunk[]): MomentItem[] {
  const located = chunks.map((c) => ({ ...c, locator: { t_start: c.t_start, t_end: c.t_end } }));
  const items: MomentItem[] = [];
  for (const row of rows) {
    const range = timeRange(row.locator);
    if (!range) continue;
    items.push({
      id: row.id,
      moment_index: row.moment_index,
      locator: range,
      title: row.title,
      description: row.description,
      citable: overlappingChunks(range, located).length > 0,
    });
  }
  return items;
}

export function createMomentsHandler(deps: MomentsDeps) {
  const { backend } = deps;
  return async (_request: Request, sourceId: string): Promise<Response> => {
    try {
      if (!(await backend.getUserId())) return fail(401, "unauthorized", MOMENTS_MESSAGES.unauthorized);
      if (!UUID.test(sourceId)) return fail(404, "not_found", MOMENTS_MESSAGES.sourceNotFound);
      if (!deps.youtubeEnabled()) return json(200, { enabled: false } satisfies MomentsResponse);
      const source = await backend.getSource(sourceId);
      if (!source) return fail(404, "not_found", MOMENTS_MESSAGES.sourceNotFound);
      // 비활성 자료는 장면 0건과 구분해 unavailable만 준다
      if (source.unavailable_at) return json(200, { enabled: true, unavailable: true } satisfies MomentsResponse);
      if (source.source_type !== "youtube") {
        return json(200, { enabled: true, unavailable: false, moments: [], summary: null } satisfies MomentsResponse);
      }
      if (source.status !== "completed") return fail(409, "source_not_ready", MOMENTS_MESSAGES.notReady);

      // 청크 위치(id·t_start·t_end)만 모은다. 본문은 응답에 넣지 않는다
      const chunks: TimedChunk[] = [];
      // 상한 안에 끝까지 못 모으면 인용 누락(citable·요약 인용 오판)을 막기 위해 실패로 돌려준다
      let complete = false;
      let afterIndex: number | null = null;
      for (let i = 0; i < MOMENT_CHUNK_MAX_PAGES; i++) {
        const result = await backend.getChunks({ sourceId, afterIndex, limit: MOMENT_CHUNK_PAGE, aroundChunkId: null });
        if (!result.ok) {
          if (result.kind === "unauthorized") return fail(401, "unauthorized", MOMENTS_MESSAGES.unauthorized);
          if (result.kind === "not_found") return fail(404, "not_found", MOMENTS_MESSAGES.sourceNotFound);
          if (result.kind === "not_ready") return fail(409, "source_not_ready", MOMENTS_MESSAGES.notReady);
          return fail(500, "server_error", MOMENTS_MESSAGES.server);
        }
        const { page } = result;
        if (page.unavailable) return json(200, { enabled: true, unavailable: true } satisfies MomentsResponse);
        for (const c of page.chunks) {
          const range = timeRange(c.locator);
          if (range) chunks.push({ chunk_id: c.id, ...range });
        }
        const last = page.chunks.at(-1);
        if (!page.has_more || !last) {
          complete = true;
          break;
        }
        afterIndex = last.chunk_index;
      }
      if (!complete) return fail(500, "chunk_limit", MOMENTS_MESSAGES.chunkLimit);

      const [rows, sentences] = await Promise.all([backend.listMoments(sourceId), backend.getSummarySentences(sourceId)]);
      return json(200, {
        enabled: true,
        unavailable: false,
        moments: toMoments(rows, chunks),
        summary: toSummary(sentences, chunks),
      } satisfies MomentsResponse);
    } catch {
      return fail(500, "server_error", MOMENTS_MESSAGES.server);
    }
  };
}
