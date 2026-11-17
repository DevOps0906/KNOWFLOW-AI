import {
  resolveDigestStatus,
  toDigestView,
  type DigestRow,
  type LatestIngest,
  type SourceDigestResponse,
} from "@/lib/sources/digest";
import { SOURCE_READ_MESSAGES, type SourceReadBackend } from "@/lib/sources/handlers";
import { loadAllChunks } from "../moments/handler";

// GET /api/sources/:id/digest: 자료 다이제스트(docs/digest-contract.md §3). 유튜브·PDF 자료만, 유튜브 플래그와 무관하다.
// 소유·삭제·비활성 판정은 RLS(sources·source_digests·processing_jobs)가 하고, 여기서 비활성 자료를 한 번 더 막는다.
// 행의 job_id가 최신 성공 작업과 다르면 pending, 저장된 인용은 지금 있는 청크만 남겨 시각(t_start)·쪽(page)으로 바꾼다.

export interface SourceDigestBackend extends Pick<SourceReadBackend, "getUserId" | "getSource" | "getChunks"> {
  /** RLS로 보이는 그 자료의 다이제스트 행. 없으면 null */
  getDigestRow(sourceId: string): Promise<DigestRow | null>;
  /** 그 자료의 최신 성공 source_ingest 작업(finished_at 기준). 없으면 null */
  getLatestIngest(sourceId: string): Promise<LatestIngest | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const DIGEST_TYPES = new Set(["youtube", "pdf"]);

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const state = (status: SourceDigestResponse["status"]): SourceDigestResponse => ({ unavailable: false, status, digest: null });
const UNAVAILABLE: SourceDigestResponse = { unavailable: true, status: "none", digest: null };

export function createSourceDigestHandler(backend: SourceDigestBackend, now: () => number = Date.now) {
  return async (_request: Request, sourceId: string): Promise<Response> => {
    try {
      if (!(await backend.getUserId())) return fail(401, "unauthorized", SOURCE_READ_MESSAGES.unauthorized);
      if (!UUID.test(sourceId)) return fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
      const source = await backend.getSource(sourceId);
      if (!source) return fail(404, "not_found", SOURCE_READ_MESSAGES.sourceNotFound);
      if (source.unavailable_at) return json(200, UNAVAILABLE);
      if (!DIGEST_TYPES.has(source.source_type) || source.status === "failed") return json(200, state("none"));
      // 처리 중(첫 처리·재처리)이면 다이제스트도 곧 만들어진다
      if (source.status !== "completed") return json(200, state("pending"));

      const [row, latest] = await Promise.all([backend.getDigestRow(sourceId), backend.getLatestIngest(sourceId)]);
      const status = resolveDigestStatus(row, latest, now());
      if (status !== "ready" || !row) return json(200, state(status));

      const chunks = await loadAllChunks(backend, sourceId);
      if (chunks === "unavailable") return json(200, UNAVAILABLE);
      if (chunks === "not_ready") return json(200, state("pending"));
      const digest = toDigestView(row.digest, chunks);
      return json(200, (digest ? { unavailable: false, status: "ready", digest } : state("failed")) satisfies SourceDigestResponse);
    } catch {
      return fail(500, "server_error", SOURCE_READ_MESSAGES.server);
    }
  };
}
