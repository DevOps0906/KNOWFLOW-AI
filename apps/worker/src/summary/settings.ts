// 영상 요약(task-029a) 한도. 값을 바꿀 때는 이 파일만 고친다.
export const VIDEO_SUMMARY_SETTINGS = {
  /** 공급자에 보낼 청크 수 상한(영상 전체에서 고르게 표본) */
  maxInputChunks: 24,
  /** 공급자에 보낼 청크 본문 합계 상한 */
  maxInputChars: 20_000,
  maxSentences: 10,
  maxSentenceChars: 300,
  maxCitationsPerSentence: 5,
  /** 요약 문장이 한 청크와 이만큼 연속으로 같으면 그 문장을 버린다(긴 원문 인용 금지) */
  maxVerbatimRun: 100,
} as const;
