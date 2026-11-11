import type { ProcessingStatus } from "@/components/status-badge";

// S-10 뷰어 표시용 변환. 응답 형태 정본은 lib/sources/handlers.ts(toSource·chunks)다.

/** GET /api/sources/:id 의 source */
export interface SourceMeta {
  id: string;
  project_id: string;
  source_type: string;
  title: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  unavailable_at: string | null;
  original_url: string | null;
  video_id: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface ViewerChunk {
  id: string;
  chunk_index: number;
  content: string;
  locator: Record<string, unknown>;
}

/** GET /api/sources/:id/chunks 응답 */
export interface ChunkPageResponse {
  items: ViewerChunk[];
  next_cursor: string | null;
  has_before: boolean;
  around: "found" | "not_found" | null;
  unavailable: boolean;
}

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", youtube: "유튜브", url: "웹 페이지" };

export function sourceTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? "자료";
}

const STATUS: Record<string, ProcessingStatus> = { completed: "ok", processing: "run", queued: "wait", failed: "fail" };

export function processingStatus(status: string): ProcessingStatus {
  return STATUS[status] ?? "wait";
}

/** 초 → mm:ss(1시간 이상이면 h:mm:ss) */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 유튜브 청크의 시작 시각(초). 없으면 null */
export function chunkStartSeconds(chunk: ViewerChunk | undefined): number | null {
  return chunk ? num(chunk.locator.t_start) : null;
}

/** 청크 위치 표시: PDF는 쪽 번호, 유튜브는 mm:ss. 위치가 없으면 null(임의로 만들지 않는다) */
export function locatorLabel(sourceType: string, locator: Record<string, unknown>): string | null {
  if (sourceType === "youtube") {
    const start = num(locator.t_start);
    if (start === null) return null;
    const end = num(locator.t_end);
    return end !== null && end > start ? `${formatTimestamp(start)} ~ ${formatTimestamp(end)}` : formatTimestamp(start);
  }
  const page = num(locator.page);
  return page !== null ? `${page}쪽` : null;
}

/** 원본 링크는 http(s)만 연다(javascript: 등 차단) */
export function safeExternalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
