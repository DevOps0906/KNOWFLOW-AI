// 자료 처리 설정(task-011 할 것 4, 구현 결정 8·9·11). 값을 바꿀 때는 이 파일만 고친다(task-013은 임베딩 값만 바꾼다).

/** 청킹: 쪽 경계를 넘지 않는다(locator.page가 한 쪽을 가리킨다). 단위는 UTF-16 코드 단위(문자열 길이). */
export const CHUNK_SETTINGS = {
  maxChars: 1000,
  /** 앞 청크와 겹치는 길이. maxChars의 절반 미만 */
  overlapChars: 150,
  /** 끊을 자리를 찾을 때 청크가 이 길이보다 짧아지지 않게 한다 */
  minChars: 500,
} as const;

/** 임베딩: 잠정 bge-m3 1024차원(ADR-0002). 벡터 저장은 task-013. */
export const EMBEDDING_SETTINGS = {
  model: "bge-m3",
  dimensions: 1024,
} as const;

/** 프로젝트 요약(후행 단계) 입력·출력 한도. 출력은 코드로 검증한다. */
export const SUMMARY_SETTINGS = {
  /** 공급자에 넘길 자료 본문 최대 길이 */
  maxInputChars: 20_000,
  maxSummaryChars: 2000,
  minQuestions: 1,
  maxQuestions: 5,
  maxQuestionChars: 200,
} as const;

/** 원본 읽기 상한(PRD 8-1: PDF 1개 50MB) */
export const SOURCE_MAX_BYTES = 50 * 1024 * 1024;

/** 자료 처리 실패 코드(고정). PDF 추출 코드는 pdf/settings.ts의 PDF_ERROR_CODES. */
export const INGEST_ERROR_CODES = {
  invalidJob: "invalid_job",
  sourceNotFound: "source_not_found",
  sourceDeleted: "source_deleted",
  sourceOwnerMismatch: "source_owner_mismatch",
  unsupportedSourceType: "unsupported_source_type",
  invalidSource: "invalid_source",
  sourcePathInvalid: "source_path_invalid",
  sourceObjectMissing: "source_object_missing",
  sourceTooLarge: "source_too_large",
  noChunks: "no_chunks",
  /** replace_source_chunks가 청크 형식을 거부(SQLSTATE 22023) */
  invalidChunks: "invalid_chunks",
  embeddingModelMismatch: "embedding_model_mismatch",
} as const;
