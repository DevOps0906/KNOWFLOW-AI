// 자료 다이제스트 조회 헬퍼(docs/digest-contract.md §3). 저장된 다이제스트(비신뢰 jsonb)를 지금 있는 청크 인용만 남겨
// 응답 형식(chunk_ids → citations)으로 바꾸고, 다이제스트 상태(ready·pending·failed·none)를 정한다.

export type DigestStatus = "ready" | "pending" | "failed" | "none";

export interface DigestCitation {
  chunk_id: string;
  /** 영상 청크의 시작 시각(초). 영상이 아니면 null */
  t_start: number | null;
  /** PDF 청크의 쪽. PDF가 아니면 null */
  page: number | null;
}

export interface DigestItemView {
  text: string;
  citations: DigestCitation[];
}

export interface SourceDigestView {
  version: 1;
  title: string;
  glance: Array<DigestItemView & { details: string[] }>;
  terms: Array<{ term: string; desc: string; citations: DigestCitation[] }>;
  chapters: Array<{ title: string; intro: string; citations: DigestCitation[]; points: Array<DigestItemView & { subpoints: DigestItemView[] }> }>;
}

export interface SourceDigestResponse {
  unavailable: boolean;
  status: DigestStatus;
  digest: SourceDigestView | null;
}

/** 저장된 다이제스트 행(RLS로 보이는 것만) */
export interface DigestRow {
  job_id: string;
  status: string;
  digest: unknown;
}

/** 그 자료의 최신 성공 source_ingest 작업 */
export interface LatestIngest {
  id: string;
  finished_at: string | null;
}

/**
 * 행이 없을 때 최신 처리 완료가 이 시간 안이면 다이제스트를 만드는 중(pending)으로 본다.
 * Worker 후행 단계(프로젝트 요약 60초 + 다이제스트 120초)보다 넉넉하게 잡는다. 지나면 none(기존 자료·공급자 없음)
 */
export const DIGEST_PENDING_WINDOW_MS = 10 * 60 * 1000;

type Chunk = { id: string; locator: Record<string, unknown> };

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function locate(locator: Record<string, unknown>): Omit<DigestCitation, "chunk_id"> {
  const t = locator.t_start;
  const p = locator.page;
  return {
    t_start: typeof t === "number" && Number.isFinite(t) && t >= 0 ? t : null,
    page: typeof p === "number" && Number.isInteger(p) && p >= 1 ? p : null,
  };
}

/** 저장된 다이제스트를 지금 있는 청크 인용만 남겨 바꾼다. 인용이 0건이 된 항목·요점이 없는 장은 버린다. 남은 게 없으면 null */
export function toDigestView(raw: unknown, chunks: readonly Chunk[]): SourceDigestView | null {
  const root = obj(raw);
  const title = root && str(root.title);
  if (!root || !title) return null;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const cite = (v: unknown): DigestCitation[] =>
    [...new Set(list(v))]
      .filter((id): id is string => typeof id === "string" && byId.has(id))
      .map((id) => ({ chunk_id: id, ...locate(byId.get(id)!.locator ?? {}) }));
  const item = (v: unknown): DigestItemView | null => {
    const o = obj(v);
    const text = o && str(o.text);
    const citations = o ? cite(o.chunk_ids) : [];
    return text && citations.length > 0 ? { text, citations } : null;
  };

  const glance = list(root.glance).flatMap((g) => {
    const base = item(g);
    if (!base) return [];
    const details = list(obj(g)?.details).filter((d): d is string => str(d) !== null);
    return [{ ...base, details }];
  });
  const terms = list(root.terms).flatMap((t) => {
    const o = obj(t);
    const term = o && str(o.term);
    const desc = o && str(o.desc);
    const citations = o ? cite(o.chunk_ids) : [];
    return term && desc && citations.length > 0 ? [{ term, desc, citations }] : [];
  });
  const chapters = list(root.chapters).flatMap((c) => {
    const o = obj(c);
    const chTitle = o && str(o.title);
    if (!o || !chTitle) return [];
    const points = list(o.points).flatMap((p) => {
      const base = item(p);
      if (!base) return [];
      const subpoints = list(obj(p)?.subpoints)
        .map(item)
        .filter((s): s is DigestItemView => s !== null);
      return [{ ...base, subpoints }];
    });
    if (points.length === 0) return [];
    return [{ title: chTitle, intro: typeof o.intro === "string" ? o.intro : "", citations: cite(o.chunk_ids), points }];
  });

  if (glance.length === 0 && chapters.length === 0) return null;
  return { version: 1, title, glance, terms, chapters };
}

/**
 * 다이제스트 행과 최신 성공 작업으로 상태를 정한다(청크 확인 전 단계).
 * - 행 없음: 최신 완료가 DIGEST_PENDING_WINDOW_MS 안이면 pending, 아니면 none
 * - 행의 job_id가 최신 성공 작업과 다르면(재처리됨) pending
 * - 그 밖은 행의 status(ready·failed)
 */
export function resolveDigestStatus(row: DigestRow | null, latest: LatestIngest | null, now: number = Date.now()): DigestStatus {
  if (!latest) return "none";
  if (!row) {
    const finished = latest.finished_at ? Date.parse(latest.finished_at) : Number.NaN;
    return Number.isFinite(finished) && now - finished < DIGEST_PENDING_WINDOW_MS ? "pending" : "none";
  }
  if (row.job_id !== latest.id) return "pending";
  return row.status === "ready" ? "ready" : "failed";
}
