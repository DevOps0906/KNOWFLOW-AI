// 유튜브 처리 설정(task-027c·028, docs/youtube-mvp-review.md#5). 값을 바꿀 때는 이 파일만 고친다.

export const YOUTUBE_SETTINGS = {
  /** 영상당 길이 상한(제안 2시간). 등록 때 이미 거르지만 Worker도 다시 확인한다 */
  maxDurationSeconds: 2 * 60 * 60,
  /** 긴 영상 분할 구간 길이(제안 20분)와 앞뒤 구간 겹침(Phase 0 run.mjs 기본값과 같다) */
  windowSeconds: 1200,
  overlapSeconds: 30,
  /**
   * 자른 구간(videoMetadata)에 대해 모델이 돌려주는 시각의 기준. 잠정 absolute — task-025 --offset-check로 확정.
   * absolute: 원본 영상 기준, relative: 구간 시작 기준
   */
  clipTimeBase: "absolute" as "absolute" | "relative",
  /** 장면 후보(시점 t)를 장면 카드 구간으로 바꿀 때의 길이(초). 영상 끝을 넘지 않게 자른다 */
  momentSpanSeconds: 30,
  /** 비신뢰 출력 상한: 구간 하나에서 받는 전사 구간·장면 수, 전사 구간 하나의 길이(문자) */
  maxSegmentsPerWindow: 3000,
  maxScenesPerWindow: 200,
  maxSegmentChars: 1000,
  /** replace_source_moments 계약(027a): 최대 500개, 제목 200자, 설명 2000자 */
  maxMoments: 500,
  maxMomentTitleChars: 200,
  maxMomentDescriptionChars: 2000,
} as const;

/** Gemini 어댑터 설정. 키는 env GEMINI_API_KEY로만 받는다(config.ts) */
export const GEMINI_SETTINGS = {
  apiBase: "https://generativelanguage.googleapis.com/v1beta/models",
  /** Phase 0 측정 모델(scripts/phase0-youtube/common.mjs DEFAULT_MODEL). env GEMINI_MODEL로 바꾼다 */
  defaultModel: "gemini-3.5-flash",
  temperature: 0,
  requestTimeoutMs: 600_000,
  /** 응답 본문 상한(바이트). 넘으면 읽기를 끊고 영구 실패(analysis_response_too_large) */
  maxResponseBytes: 8 * 1024 * 1024,
} as const;

/** 유튜브 처리 실패 코드(고정) */
export const YOUTUBE_ERROR_CODES = {
  /** 플래그(YOUTUBE_ENABLED)가 꺼진 Worker가 유튜브 작업을 받음 */
  disabled: "youtube_disabled",
  invalidVideo: "invalid_video",
  /** 모델이 안전·정책 사유로 거절(재시도 없음) */
  policyRejected: "analysis_policy_rejected",
  /** 공급자가 요청을 거절(4xx: 비공개·입력 초과·키 권한 등, 재시도 없음) */
  requestRejected: "analysis_request_rejected",
  /** 출력이 잘림(MAX_TOKENS 등) */
  outputTruncated: "analysis_output_truncated",
  /** 출력이 JSON·스키마에 맞지 않음 */
  invalidOutput: "analysis_invalid_output",
  /** 응답 본문이 상한(GEMINI_SETTINGS.maxResponseBytes)을 넘음 */
  responseTooLarge: "analysis_response_too_large",
  /** replace_source_moments가 장면 형식을 거부(22023) */
  invalidMoments: "invalid_moments",
} as const;

export const canonicalVideoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
