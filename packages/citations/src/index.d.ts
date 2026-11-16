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

/** 영상 시각 구간(초). 반열린 구간 [t_start, t_end) */
export interface TimeRange {
  t_start: number;
  t_end: number;
}

/**
 * 장면(moment)과 겹치는 청크 전부를 겹친 길이 내림차순(같으면 t_start 오름차순, 그다음 입력 순서)으로 돌려준다.
 * 반열린 구간이라 맞닿기만 하면 겹침이 아니다. locator가 올바른 시각 구간이 아닌 청크·잘못된 moment는 무시한다.
 * 빈 배열이면 그 장면은 인용할 수 없다.
 */
export function overlappingChunks<TChunk extends { locator?: unknown }>(
  moment: TimeRange,
  chunks: readonly TChunk[],
): TChunk[];
