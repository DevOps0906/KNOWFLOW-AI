// 자료 처리 실패 코드 → 화면 문구(한 표). 원문 코드는 화면에 보이지 않는다. error_message_safe는 쓰지 않는다.
// Worker 상수(pdf·ingest·youtube settings)와 DB·러너 코드가 모두 들어 있는지 sources.test.ts가 원본 파일을 읽어 확인한다.

export const GENERIC_SOURCE_ERROR = "자료를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

const RETRY_LATER = "일시적인 문제로 처리하지 못했습니다. 다시 시도해 주세요.";
const SERVER_ISSUE = "서버 문제로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export const SOURCE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // PDF 추출(apps/worker/src/pdf/settings.ts PDF_ERROR_CODES)
  invalid_pdf: "PDF 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.",
  file_too_large: "파일이 너무 큽니다. 50MB 이하의 PDF만 처리할 수 있습니다.",
  content_hash_mismatch: "업로드한 파일이 확인되지 않았습니다. 다시 올려 주세요.",
  encrypted_pdf: "암호가 걸린 PDF는 처리할 수 없습니다. 암호를 해제한 뒤 다시 올려 주세요.",
  too_many_pages: "쪽 수가 너무 많습니다. 500쪽 이하의 PDF만 처리할 수 있습니다.",
  scanned_pdf: "글자를 추출할 수 없는 PDF입니다(스캔 이미지). 텍스트가 있는 PDF를 올려 주세요.",
  parser_timeout: "PDF를 읽는 데 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.",
  parser_out_of_memory: "PDF가 너무 복잡해 처리하지 못했습니다. 파일을 나눠 올려 주세요.",
  parser_output_too_large: "PDF에서 나온 내용이 너무 많아 처리하지 못했습니다. 파일을 나눠 올려 주세요.",
  parser_crashed: "PDF를 읽는 중 문제가 생겼습니다. 다시 시도해 주세요.",

  // 자료 처리 공통(apps/worker/src/ingest/settings.ts INGEST_ERROR_CODES)
  invalid_job: SERVER_ISSUE,
  source_not_found: "자료를 찾을 수 없어 처리하지 못했습니다.",
  source_deleted: "삭제된 자료입니다.",
  source_owner_mismatch: "자료를 처리할 수 없습니다.",
  unsupported_source_type: "아직 지원하지 않는 자료 유형입니다.",
  invalid_source: "자료 정보가 올바르지 않아 처리하지 못했습니다.",
  source_path_invalid: "업로드한 파일을 찾을 수 없습니다. 다시 올려 주세요.",
  source_object_missing: "업로드한 파일을 찾을 수 없습니다. 다시 올려 주세요.",
  source_too_large: "파일이 너무 큽니다. 50MB 이하의 PDF만 처리할 수 있습니다.",
  no_chunks: "자료에서 읽을 수 있는 내용을 찾지 못했습니다.",
  invalid_chunks: SERVER_ISSUE,
  embedding_model_mismatch: SERVER_ISSUE,

  // 유튜브(apps/worker/src/youtube/settings.ts YOUTUBE_ERROR_CODES)
  youtube_disabled: "유튜브 기능 준비 중",
  invalid_video: "영상 정보를 확인할 수 없습니다. 공개된 영상인지 확인해 주세요.",
  analysis_policy_rejected: "이 영상은 분석할 수 없습니다.",
  analysis_request_rejected: "이 영상은 분석할 수 없습니다. 공개 여부를 확인해 주세요.",
  analysis_output_truncated: "영상 분석 결과가 너무 길어 처리하지 못했습니다.",
  analysis_invalid_output: "영상 분석 결과를 읽지 못했습니다. 다시 시도해 주세요.",
  analysis_response_too_large: "영상 분석 결과가 너무 커서 처리하지 못했습니다.",
  invalid_moments: "영상 분석 결과를 읽지 못했습니다. 다시 시도해 주세요.",
  invalid_recheck_result: SERVER_ISSUE,
  recheck_request_rejected: SERVER_ISSUE,

  // DB(reap_expired_jobs·fail_job)와 러너(apps/worker/src/runner.ts)
  lease_expired: RETRY_LATER,
  no_handler: SERVER_ISSUE,
  handler_error: RETRY_LATER,
  unknown: GENERIC_SOURCE_ERROR,
};

/** 실패 코드의 화면 문구. 코드가 없으면 null, 모르는 코드는 일반 문구. */
export function sourceErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(SOURCE_ERROR_MESSAGES, code) ? SOURCE_ERROR_MESSAGES[code]! : GENERIC_SOURCE_ERROR;
}
