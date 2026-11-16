import { cleanUntrustedText } from "@/components/youtube/sanitize";
import type { SourceReadBackend, SourceRow } from "@/lib/sources/handlers";

// A-07 GET /moments: 유튜브 요약·장면 카드(L0). 소유·삭제·비활성 판정은 RLS가 하고 여기서는 응답 매핑만 한다.
// 기능 플래그가 꺼져 있으면 {enabled:false}. 비활성(unavailable_at) 자료는 메타와 unavailable:true만(장면 0건과 구분).

export interface MomentRow {
  id: string;
  moment_index: number;
  locator: Record<string, unknown>;
  title: string;
  description: string;
}

export interface SummaryRow {
  sentences: unknown;
  model: string;
}

export interface MomentsBackend extends Pick<SourceReadBackend, "getUserId" | "getSource"> {
  getMoments(sourceId: string): Promise<MomentRow[]>;
  getSummary(sourceId: string): Promise<SummaryRow | null>;
}

export interface MomentsDeps {
  backend: MomentsBackend;
  /** 기능 플래그(YOUTUBE_ENABLED 판정은 호출부) */
  enabled: () => boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function sourceMeta(row: SourceRow) {
  return {
    id: row.id,
    title: cleanUntrustedText(row.title),
    channel_title: row.channel_title === null ? null : cleanUntrustedText(row.channel_title),
    original_url: row.original_url,
  };
}

export function createMomentsHandler(deps: MomentsDeps) {
  const { backend } = deps;
  return async function moments(_request: Request, sourceId: string): Promise<Response> {
    try {
      if (!(await backend.getUserId())) return fail(401, "unauthorized", "로그인이 필요합니다.");
      if (!deps.enabled()) return json(200, { enabled: false });
      if (!UUID.test(sourceId)) return fail(404, "not_found", "자료를 찾을 수 없습니다.");
      const row = await backend.getSource(sourceId);
      if (!row || row.source_type !== "youtube") return fail(404, "not_found", "자료를 찾을 수 없습니다.");
      if (row.unavailable_at) return json(200, { enabled: true, unavailable: true, source: sourceMeta(row) });

      const [momentRows, summaryRow] = await Promise.all([backend.getMoments(sourceId), backend.getSummary(sourceId)]);

      const items = momentRows.flatMap((m) => {
        const t_start = num(m.locator.t_start);
        const t_end = num(m.locator.t_end);
        const title = cleanUntrustedText(m.title);
        if (t_start === null || t_end === null || t_end <= t_start || !title) return [];
        return [{ id: m.id, moment_index: m.moment_index, t_start, t_end, title, description: cleanUntrustedText(m.description) }];
      });

      let summary: { model: string; sentences: Array<{ text: string; citations: Array<{ chunk_id: string; t_start: number }> }> } | null = null;
      if (summaryRow && Array.isArray(summaryRow.sentences)) {
        // 저장 시점에 RPC가 청크 locator에서 만든 citations만 쓴다. 유효 인용이 0건인 문장은 뺀다(근거 없는 문장 금지)
        const sentences = (summaryRow.sentences as unknown[]).flatMap((x) => {
          const o = x as { text?: unknown; citations?: unknown } | null;
          const text = cleanUntrustedText(o?.text);
          const citations = (Array.isArray(o?.citations) ? o.citations : []).flatMap((c: unknown) => {
            const cc = c as { chunk_id?: unknown; t_start?: unknown } | null;
            const t_start = num(cc?.t_start);
            return typeof cc?.chunk_id === "string" && UUID.test(cc.chunk_id) && t_start !== null ? [{ chunk_id: cc.chunk_id, t_start }] : [];
          });
          return text && citations.length > 0 ? [{ text, citations }] : [];
        });
        if (sentences.length > 0) summary = { model: cleanUntrustedText(summaryRow.model), sentences };
      }

      return json(200, { enabled: true, unavailable: false, source: sourceMeta(row), moments: items, summary });
    } catch {
      return fail(500, "server_error", "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
}
