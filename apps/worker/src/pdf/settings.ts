// PDF 추출 설정(task-011 구현 결정 4·5·6). 값을 바꿀 때는 이 파일만 고친다.
export const PDF_SETTINGS = {
  /** 이 쪽수를 넘으면 too_many_pages */
  maxPages: 500,
  /** 쪽이 "텍스트 쪽"이려면 유효 문자(한글·라틴·숫자)가 이 개수 이상 */
  minValidCharsPerPage: 10,
  /** 공백을 뺀 문자 중 유효 문자 비율이 이 값 이상 */
  minValidCharRatio: 0.5,
  /** 공백을 뺀 문자 중 사용자 정의 영역(PUA) 문자 비율이 이 값을 넘으면 깨진 텍스트로 본다 */
  maxPuaRatio: 0.2,
  /** 전체 쪽 중 텍스트 쪽 비율이 이 값 미만이면 scanned_pdf */
  minTextPageRatio: 0.3,
} as const;

/** 파서 하위 프로세스 자원 한도 */
export const PARSER_LIMITS = {
  /** 입력 PDF 바이트 상한(PRD 8-1: PDF 1개 50MB, ingest/settings.ts의 SOURCE_MAX_BYTES와 같은 값). 해시 계산 전에 검사한다 */
  maxInputBytes: 50 * 1024 * 1024,
  timeoutMs: 120_000,
  maxOldSpaceMb: 512,
  /** 하위 프로세스 stdout(JSON) 상한 */
  maxOutputBytes: 64 * 1024 * 1024,
} as const;

/** PDF 추출 실패 코드(고정). processing_jobs·sources.error_code에 그대로 저장된다. */
export const PDF_ERROR_CODES = {
  invalidPdf: "invalid_pdf",
  fileTooLarge: "file_too_large",
  contentHashMismatch: "content_hash_mismatch",
  encryptedPdf: "encrypted_pdf",
  tooManyPages: "too_many_pages",
  scannedPdf: "scanned_pdf",
  parserTimeout: "parser_timeout",
  parserOutOfMemory: "parser_out_of_memory",
  parserOutputTooLarge: "parser_output_too_large",
  parserCrashed: "parser_crashed",
} as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[keyof typeof PDF_ERROR_CODES];
