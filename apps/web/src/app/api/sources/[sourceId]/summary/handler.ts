import type { SourceSummaryResponse, SourceSummarySentence } from "@/components/report/types";
import { SOURCE_READ_MESSAGES, type SourceReadBackend } from "@/lib/sources/handlers";
import { loadAllChunks } from "../moments/handler";

// GET /api/sources/:id/summary: PDF 자료 요약(source_summaries). 유튜브 플래그와 무관하다(유튜브 요약은 /moments).
// 소유·삭제·비활성 판정은 RLS(sources·source_summaries)가 하고, 여기서 비활성 자료를 한 번 더 막는다.
// 저장된 인용은 지금 있는 청크만 남기고 각 청크의 쪽(locator.page)으로 바꾼다.

export interface SourceSummaryBackend extends Pick<SourceReadBackend, "getUserId" | "getSource" | "getChunks"> {
  /** RLS로 보이는 그 자료의 요약 sentences(jsonb). 없으면 null */
  getSummarySentences(sourceId: string): Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

const EMPTY: SourceSummaryResponse = { unavailable: false, summary: null };
const UNAVAILABLE: SourceSummaryResponse = { unavailable: true, summary: null };

const pageOf = (locator: Record<string, unknown> | undefined): number | null => {
  const p = locator?.page;
  return typeof p === "number" && Number.isInteger(p) && p >= 1 ? p : null;
};

/** 저장된 요약(비신뢰 jsonb)을 지금 있는 청크 인용만 남겨 변환한다. 인용이 0건이 된 문장은 버린다 */
function toSummary(raw: unknown, chunks: Array<{ id: string; locator: Record<string, unknown> }>): SourceSummaryResponse["summary"] {
  if (!Array.isArray(raw)) return null;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const sentences: SourceSummarySentence[] = [];
  for (const entry of raw) {
    const { text, chunk_ids: ids } = (entry ?? {}) as { text?: unknown; chunk_ids?: unknown };
    if (typeof text !== "string" || !text.trim() || !Array.isArray(ids)) continue;
    const citations = [...new Set(ids)]
      .filter((id): id is string => typeof id === "string" && byId.has(id))
      .map((id) => ({ chunk_id: id, page: pageOf(byId.get(id)?.locator) }));
    if (citations.length > 0) sentences.push({ text, citations });
  }
  return sentences.length > 0 ? { sentences } : null;
}

export function createSourceSummaryHandler(backend: SourceSummaryBackend) {
  return async (_request: Request, sourceId: string): Promise<Response> => {
    try {
      if (!(await backend.getUserId())) return fail(401, "unauthorized", SOURCE_READ_MESSAGES.unauthorized);
      if (!UUID.test(sourceId)) return fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
      const source = await backend.getSource(sourceId);
      if (!source) return fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
      if (source.unavailable_at) return json(200, UNAVAILABLE);
      if (source.source_type !== "pdf" || source.status !== "completed") return json(200, EMPTY);

      const raw = await backend.getSummarySentences(sourceId);
      if (raw === null) return json(200, EMPTY);
      const chunks = await loadAllChunks(backend, sourceId);
      if (chunks === "unavailable") return json(200, UNAVAILABLE);
      if (chunks === "not_ready") return json(200, EMPTY);
      return json(200, { unavailable: false, summary: toSummary(raw, chunks) } satisfies SourceSummaryResponse);
    } catch {
      return fail(500, "server_error", SOURCE_READ_MESSAGES.server);
    }
  };
}
