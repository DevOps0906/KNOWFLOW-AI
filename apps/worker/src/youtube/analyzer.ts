// 영상 분석 공급자 인터페이스(task-027c). 분석기는 전사 구간·장면 후보만 돌려주며, 출력은 신뢰하지 않는 데이터다.
// 형식·시각 검증은 pipeline.ts가 한다. 로컬·테스트는 스텁(네트워크 없음), 실제 공급자는 gemini.ts.

/** 분석 구간(초). clipped면 공급자에 구간을 잘라 넘긴다 */
export interface AnalysisWindow {
  index: number;
  start: number;
  end: number;
  clipped: boolean;
}

export interface AnalysisRequest {
  videoId: string;
  /** 정규 URL https://www.youtube.com/watch?v=<id> */
  videoUrl: string;
  window: AnalysisWindow;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * ok: output은 공급자가 준 JSON(검증 전). blocked: 안전·정책 거절. truncated: 출력 잘림. invalid_output: JSON이 아님.
 * 공급자 호출 비용은 결과와 무관하게 사용 기록에 남기므로 실패도 usage와 함께 돌려준다.
 */
export type AnalysisResponse =
  | { kind: "ok"; output: unknown; usage: TokenUsage }
  | { kind: "blocked" | "truncated" | "invalid_output"; usage: TokenUsage };

export interface VideoAnalyzer {
  readonly name: string;
  readonly model: string;
  /** 자른 구간에서 모델이 쓰는 시각 기준 */
  readonly clipTimeBase: "absolute" | "relative";
  /**
   * 일시 오류(네트워크·429·5xx)는 AnalyzerTransientError(재시도), 요청 거절(4xx)은 PermanentError를 던진다.
   */
  analyze(request: AnalysisRequest, signal: AbortSignal): Promise<AnalysisResponse>;
}

/** 다시 시도하면 나을 수 있는 공급자 오류. 메시지에는 고정 분류만 담는다(응답 본문·키 없음) */
export class AnalyzerTransientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AnalyzerTransientError";
  }
}

const STUB_STEP_SECONDS = 15;

/** 로컬 검증용 스텁: 구간마다 15초 간격의 고정 전사와 구간 가운데의 장면 후보 1개(원본 기준 절대 시각) */
export function createStubVideoAnalyzer(): VideoAnalyzer {
  return {
    name: "stub",
    model: "stub",
    clipTimeBase: "absolute",
    async analyze({ window }, signal) {
      signal.throwIfAborted();
      const segments = [];
      for (let t = window.start; t < window.end; t += STUB_STEP_SECONDS) {
        const end = Math.min(t + STUB_STEP_SECONDS, window.end);
        segments.push({ t_start: t, t_end: end, text: `스텁 전사 ${t}초부터 ${end}초까지의 발화입니다.` });
      }
      const scenes = [{ t: Math.floor((window.start + window.end) / 2), title: `스텁 장면 ${window.index + 1}`, description: "스텁 분석기가 만든 장면 설명입니다." }];
      return { kind: "ok", output: { segments, scenes }, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
