// 자료 다이제스트 조회 응답(docs/digest-contract.md §3). 저장 형식(§2)의 chunk_ids가 citations로 바뀐 형태.
// 인용은 그 자료의 현재 청크만 온다. 영상은 t_start(초), PDF는 page를 쓴다(모르면 null).

export interface DigestCitation {
  chunk_id: string;
  t_start: number | null;
  page: number | null;
}

export interface DigestGlance {
  text: string;
  details: string[];
  citations: DigestCitation[];
}

export interface DigestTerm {
  term: string;
  desc: string;
  citations: DigestCitation[];
}

export interface DigestSubpoint {
  text: string;
  citations: DigestCitation[];
}

export interface DigestPoint {
  text: string;
  citations: DigestCitation[];
  subpoints: DigestSubpoint[];
}

export interface DigestChapter {
  title: string;
  intro: string;
  citations: DigestCitation[];
  points: DigestPoint[];
}

export interface Digest {
  version: 1;
  title: string;
  glance: DigestGlance[];
  terms: DigestTerm[];
  chapters: DigestChapter[];
}

/** pending: 생성 대기·진행 중 · none: 없음 · failed: 생성 실패 */
export type DigestStatus = "ready" | "pending" | "none" | "failed";

/** GET /api/sources/:id/digest 응답 */
export interface DigestResponse {
  unavailable: boolean;
  status: DigestStatus;
  digest: Digest | null;
}

/** 핵심: 한눈에 보기·핵심 용어만 · 딥 리서치: 전체 */
export type DigestMode = "core" | "deep";
