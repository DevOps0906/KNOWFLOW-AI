// Gemini 요약 공급자(프로젝트 요약·영상 요약). WORKER_SUMMARY_PROVIDER=gemini일 때만 쓴다.
// 키는 헤더로만 보내고(URL·로그·오류 메시지에 넣지 않는다), 응답 본문은 오류 메시지·로그에 담지 않는다.
// 지시는 systemInstruction, 자료는 user part의 JSON 직렬화 데이터로만 넘긴다(자료 안 문장을 지시로 섞지 않는다).
// 재시도는 하지 않는다. 출력 불량(JSON 아님·MAX_TOKENS·차단)은 예외 대신 빈 결과+사용량을 돌려줘 검증이 거절하게 한다.
import { PermanentError } from "../runner.js";
import { readCapped } from "../youtube/gemini.js";
import { GEMINI_SETTINGS } from "../youtube/settings.js";
import type { VideoSummaryPrompt, VideoSummaryProvider } from "../youtube/summary.js";
import { SUMMARY_GEMINI_SETTINGS } from "./settings.js";
import type { SummaryPrompt, SummaryProvider } from "./summary.js";

/** 네트워크·HTTP 실패. 메시지는 고정 코드만(키·본문 없음) */
export class SummaryProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SummaryProviderError";
  }
}

export const PROJECT_SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: { summary: { type: "STRING" }, questions: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["summary", "questions"],
} as const;

export const VIDEO_SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    sentences: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, chunk_ids: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["text", "chunk_ids"],
      },
    },
  },
  required: ["sentences"],
} as const;

const MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export interface GeminiSummaryOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function usageOf(raw: unknown): Usage {
  const u = (raw as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!u) return { inputTokens: null, outputTokens: null };
  const out = count(u.candidatesTokenCount);
  const thoughts = count(u.thoughtsTokenCount) ?? 0;
  return { inputTokens: count(u.promptTokenCount), outputTokens: out === null ? null : out + thoughts };
}

/** 응답 해석. STOP으로 끝난 JSON 객체만 output으로, 그 밖(차단·MAX_TOKENS·JSON 아님)은 null */
export function parseSummaryResponse(raw: unknown): { output: Record<string, unknown> | null; usage: Usage } {
  const usage = usageOf(raw);
  const r = raw as { candidates?: unknown } | null;
  const candidate = Array.isArray(r?.candidates) ? (r.candidates[0] as { finishReason?: unknown; content?: { parts?: unknown } } | undefined) : undefined;
  if (!candidate || candidate.finishReason !== "STOP") return { output: null, usage };
  const parts = Array.isArray(candidate.content?.parts) ? (candidate.content.parts as { text?: unknown }[]) : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  try {
    const out = JSON.parse(text) as unknown;
    return { output: typeof out === "object" && out !== null && !Array.isArray(out) ? (out as Record<string, unknown>) : null, usage };
  } catch {
    return { output: null, usage };
  }
}

type Call = (system: string, data: unknown, schema: object, signal?: AbortSignal) => Promise<ReturnType<typeof parseSummaryResponse>>;

function createCaller(opts: GeminiSummaryOptions): { model: string; call: Call } {
  const model = opts.model ?? SUMMARY_GEMINI_SETTINGS.defaultModel;
  if (!MODEL_RE.test(model)) throw new Error("GEMINI_SUMMARY_MODEL 형식이 올바르지 않습니다");
  if (!opts.apiKey) throw new Error("GEMINI_API_KEY가 필요합니다");
  const doFetch = opts.fetch ?? fetch;
  const endpoint = `${GEMINI_SETTINGS.apiBase}/${model}:generateContent`;
  const timeoutMs = opts.timeoutMs ?? SUMMARY_GEMINI_SETTINGS.requestTimeoutMs;

  const call: Call = async (system, data, schema, signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // 호출자 신호(임대 상실)로 끊긴 것은 그대로 올리고, 그 밖은 고정 코드로 바꾼다
    const transportError = (e: unknown) => {
      if (signal?.aborted) return e;
      if (e instanceof PermanentError) return new SummaryProviderError("response_too_large");
      return new SummaryProviderError(timeout.aborted || (e instanceof Error && e.name === "TimeoutError") ? "timeout" : "network_error");
    };
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(data) }] }],
      generationConfig: {
        temperature: SUMMARY_GEMINI_SETTINGS.temperature,
        maxOutputTokens: SUMMARY_GEMINI_SETTINGS.maxOutputTokens,
        thinkingConfig: { thinkingBudget: SUMMARY_GEMINI_SETTINGS.thinkingBudget },
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    };
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      throw transportError(e);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new SummaryProviderError(res.status === 408 || res.status === 429 || res.status >= 500 ? `http_${res.status}` : "request_rejected");
    }
    let text: string;
    try {
      text = await readCapped(res, SUMMARY_GEMINI_SETTINGS.maxResponseBytes);
    } catch (e) {
      throw transportError(e);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { output: null, usage: { inputTokens: null, outputTokens: null } };
    }
    return parseSummaryResponse(raw);
  };
  return { model, call };
}

export function createGeminiSummaryProvider(opts: GeminiSummaryOptions): SummaryProvider {
  const { model, call } = createCaller(opts);
  return {
    name: "gemini",
    model,
    async summarize(prompt: SummaryPrompt, signal?: AbortSignal) {
      const { output, usage } = await call(prompt.system, { data: prompt.data }, PROJECT_SUMMARY_SCHEMA, signal);
      return { summary: output?.summary ?? null, questions: output?.questions ?? null, ...usage };
    },
  };
}

export function createGeminiVideoSummaryProvider(opts: GeminiSummaryOptions): VideoSummaryProvider {
  const { model, call } = createCaller(opts);
  return {
    name: "gemini",
    model,
    async summarize(prompt: VideoSummaryPrompt, signal?: AbortSignal) {
      const { output, usage } = await call(prompt.system, { chunks: prompt.chunks }, VIDEO_SUMMARY_SCHEMA, signal);
      return { sentences: output?.sentences ?? null, ...usage };
    },
  };
}
