export type CitationStatus = "ok" | "partial" | "none";

/** `match_chunks` 결과(project_id 강제) 또는 저장된 청크. 호출자가 ID를 `chunk_id`로 넘긴다. */
export interface AllowedChunk {
  chunk_id: string;
}

export interface VerifyCitationsInput<TChunk extends AllowedChunk> {
  /** 모델 출력(비신뢰). 소문자 UUID 문자열만 인정하고 정규화하지 않는다. */
  cited: unknown;
  allowedChunks: readonly TChunk[];
}

export interface VerifyCitationsResult<TChunk extends AllowedChunk> {
  /** `allowedChunks`의 레코드. 인용 순서·중복을 보존하며 위치는 이 레코드 값만 쓴다. */
  verified: TChunk[];
  /** 거부된 입력값. 인용 순서·중복을 보존한다. */
  rejected: unknown[];
  /** `none`: 통과 0건, `partial`: 통과·거부 혼재, `ok`: 전부 통과. */
  status: CitationStatus;
}

export function verifyCitations<TChunk extends AllowedChunk>(
  input: VerifyCitationsInput<TChunk>,
): VerifyCitationsResult<TChunk>;

/** 장면 카드(또는 시각 구간). 반열린 구간 [t_start, t_end). */
export interface TimeSpan {
  t_start: number;
  t_end: number;
}

export interface TimedChunk {
  chunk_id: string;
  locator?: unknown;
}

/** 겹치는 청크 전부를 겹친 길이 내림차순(같으면 입력 순서)으로. 맞닿음은 겹침 아님. 없으면 빈 배열(인용 불가). */
export function overlappingChunks<TChunk extends TimedChunk>(moment: TimeSpan, chunks: readonly TChunk[]): TChunk[];
