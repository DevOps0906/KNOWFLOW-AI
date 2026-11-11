// 유튜브 자료 처리(task-027c + 028): 구간 분할 → 분석(공급자) → 형식·시각 검증 → 공용 청킹(locator t_start/t_end)
// → 펜싱된 청크·장면 교체 + 완료. 분석 출력(전사·제목·설명)은 신뢰하지 않는 데이터다. 본문은 로그에 남기지 않는다.
import { chunkTranscript, type ChunkDraft, type TimeLocator, type TranscriptSegment } from "../ingest/chunking.js";
import { INGEST_ERROR_CODES } from "../ingest/settings.js";
import type { IngestSource, IngestStore } from "../ingest/store.js";
import type { Logger } from "../log.js";
import { normalizeText } from "../pdf/text.js";
import { PermanentError, StaleAttemptError, type HandlerContext } from "../runner.js";
import type { AnalysisWindow, VideoAnalyzer } from "./analyzer.js";
import { canonicalVideoUrl, VIDEO_ID_RE, YOUTUBE_ERROR_CODES, YOUTUBE_SETTINGS } from "./settings.js";
import type { MomentDraft, YoutubeStore } from "./store.js";

type Settings = typeof YOUTUBE_SETTINGS;

export interface YoutubeDeps {
  analyzer: VideoAnalyzer;
  store: YoutubeStore;
}

export interface Scene {
  t: number;
  title: string;
  description: string;
}

export interface WindowOutput {
  segments: TranscriptSegment[];
  scenes: Scene[];
  /** 형식 위반으로 버린 항목 수 */
  droppedSegments: number;
  droppedScenes: number;
}

const fail = (code: string) => new PermanentError(code);

const FAILURE_CODES = {
  blocked: YOUTUBE_ERROR_CODES.policyRejected,
  truncated: YOUTUBE_ERROR_CODES.outputTruncated,
  invalid_output: YOUTUBE_ERROR_CODES.invalidOutput,
} as const;

/** 영상 길이를 분석 구간으로 나눈다(앞뒤 구간은 overlap만큼 겹친다). 한 구간이면 자르지 않는다 */
export function planWindows(durationSec: number, windowSec: number = YOUTUBE_SETTINGS.windowSeconds, overlapSec: number = YOUTUBE_SETTINGS.overlapSeconds): AnalysisWindow[] {
  if (!(windowSec > overlapSec && overlapSec >= 0)) throw new Error("분할 설정이 올바르지 않습니다");
  if (durationSec <= windowSec) return [{ index: 0, start: 0, end: durationSec, clipped: false }];
  const out: AnalysisWindow[] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + windowSec, durationSec);
    out.push({ index: out.length, start, end, clipped: true });
    if (end >= durationSec) return out;
    start = end - overlapSec;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 길이 1~max의 정규화된 문자열, 아니면 null */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length > max * 4) return null;
  const s = normalizeText(v);
  return s.length >= 1 && s.length <= max ? s : null;
}

/**
 * 공급자 출력의 형식 검증. 최상위 형식이 틀렸거나 개수 상한을 넘으면 출력 전체를 버린다(영구 실패),
 * 항목 하나의 형식 위반은 그 항목만 버리고 센다. 알려진 필드만 꺼낸다.
 */
export function parseWindowOutput(output: unknown, settings: Settings = YOUTUBE_SETTINGS): WindowOutput {
  if (!isObject(output) || !Array.isArray(output.segments) || !Array.isArray(output.scenes)) throw fail(YOUTUBE_ERROR_CODES.invalidOutput);
  if (output.segments.length > settings.maxSegmentsPerWindow || output.scenes.length > settings.maxScenesPerWindow) {
    throw fail(YOUTUBE_ERROR_CODES.invalidOutput);
  }
  const out: WindowOutput = { segments: [], scenes: [], droppedSegments: 0, droppedScenes: 0 };
  for (const s of output.segments as unknown[]) {
    const text = isObject(s) && finite(s.t_start) && finite(s.t_end) ? cleanText(s.text, settings.maxSegmentChars) : null;
    if (text === null) out.droppedSegments++;
    else out.segments.push({ t_start: (s as { t_start: number }).t_start, t_end: (s as { t_end: number }).t_end, text });
  }
  for (const s of output.scenes as unknown[]) {
    const ok = isObject(s) && finite(s.t);
    const title = ok ? cleanText(s.title, settings.maxMomentTitleChars) : null;
    const description = ok ? cleanText(s.description, settings.maxMomentDescriptionChars) : null;
    if (title === null || description === null) out.droppedScenes++;
    else out.scenes.push({ t: (s as { t: number }).t, title, description });
  }
  return out;
}

export interface MergedAnalysis {
  segments: TranscriptSegment[];
  scenes: Scene[];
  /** 형식·시각 검증(범위 밖·역순·구간 안 순서·겹침)으로 버린 수. 다른 구간 소유라 넘긴 항목은 세지 않는다 */
  droppedSegments: number;
  droppedScenes: number;
}

/** 구간 idx가 소유하는 시간 [start, end): 인접 구간 겹침의 중간점이 경계다 */
export function ownedRange(windows: AnalysisWindow[], idx: number, durationSec: number): { start: number; end: number } {
  const w = windows[idx]!;
  const prev = windows[idx - 1];
  const next = windows[idx + 1];
  return {
    start: prev ? (w.start + prev.end) / 2 : 0,
    end: next ? (next.start + w.end) / 2 : durationSec,
  };
}

/**
 * 시각 검증과 구간 합치기(docs/youtube-mvp-review.md#5).
 * 항목마다: [0, 영상 길이]와 자기 분석 구간 [start, end] 안이어야 하고 t_start < t_end(장면은 t < 끝).
 * 같은 구간 안에서는 시간순·겹침 없음. 위반 항목은 그 항목만 버리고 센다.
 * 여러 구간이면 각 구간은 소유 범위 [own_start, own_end)를 갖고, t_start(장면은 t)가 그 안인 항목만 채택한다
 * (경계를 넘어 끝나는 t_end는 위 범위 안이면 허용). 같은 발화가 두 구간에 나오면 소유 구간의 것 하나만 남는다.
 */
export function mergeWindows(
  results: { window: AnalysisWindow; output: WindowOutput }[],
  durationSec: number,
  timeBase: "absolute" | "relative",
): MergedAnalysis {
  const merged: MergedAnalysis = { segments: [], scenes: [], droppedSegments: 0, droppedScenes: 0 };
  const windows = results.map((r) => r.window);
  results.forEach(({ window, output }, idx) => {
    merged.droppedSegments += output.droppedSegments;
    merged.droppedScenes += output.droppedScenes;
    const shift = window.clipped && timeBase === "relative" ? window.start : 0;
    const lo = Math.max(0, window.start);
    const hi = Math.min(window.end, durationSec);
    const own = ownedRange(windows, idx, durationSec);
    let last: TranscriptSegment | null = null;
    for (const s of output.segments) {
      const abs = { ...s, t_start: s.t_start + shift, t_end: s.t_end + shift };
      if (abs.t_start < lo || abs.t_end > hi || abs.t_end <= abs.t_start || (last !== null && abs.t_start < last.t_end)) {
        merged.droppedSegments++;
        continue;
      }
      last = abs;
      if (abs.t_start >= own.start && abs.t_start < own.end) merged.segments.push(abs);
    }
    let lastT: number | null = null;
    for (const s of output.scenes) {
      const abs = { ...s, t: s.t + shift };
      if (abs.t < lo || abs.t >= hi || (lastT !== null && abs.t <= lastT)) {
        merged.droppedScenes++;
        continue;
      }
      lastT = abs.t;
      if (abs.t >= own.start && abs.t < own.end) merged.scenes.push(abs);
    }
  });
  return merged;
}

/** 장면 후보 → 장면 카드(replace_source_moments 형식). 상한을 넘는 뒤쪽 후보는 버린다 */
export function toMoments(scenes: Scene[], durationSec: number, settings: Settings = YOUTUBE_SETTINGS): MomentDraft[] {
  return scenes.slice(0, settings.maxMoments).map((s, moment_index) => ({
    moment_index,
    locator: { t_start: s.t, t_end: Math.min(s.t + settings.momentSpanSeconds, durationSec) },
    title: s.title,
    description: s.description,
  }));
}

/** 유튜브 자료 하나를 처리해 청크·장면을 저장하고 작업을 완료한다. 저장한 청크를 돌려준다(후행 요약 입력) */
export async function processYoutubeSource(
  deps: YoutubeDeps & { recordUsage: IngestStore["recordUsage"]; log?: Logger },
  ctx: HandlerContext,
  source: Pick<IngestSource, "id" | "project_id" | "user_id">,
): Promise<ChunkDraft<TimeLocator>[]> {
  const { job, signal, progress } = ctx;
  const video = await deps.store.loadVideo(source.id);
  const duration = video?.duration_seconds;
  if (!video?.video_id || !VIDEO_ID_RE.test(video.video_id)) throw fail(YOUTUBE_ERROR_CODES.invalidVideo);
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > YOUTUBE_SETTINGS.maxDurationSeconds) {
    throw fail(YOUTUBE_ERROR_CODES.invalidVideo);
  }

  const windows = planWindows(duration);
  const results: { window: AnalysisWindow; output: WindowOutput }[] = [];
  for (const window of windows) {
    await progress("analyze", 10 + Math.round((55 * window.index) / windows.length));
    signal.throwIfAborted();
    const r = await deps.analyzer.analyze({ videoId: video.video_id, videoUrl: canonicalVideoUrl(video.video_id), window }, signal);
    // 공급자 호출은 결과가 쓸모없어도 사용 기록에 남긴다(월 처리 차감은 등록 때 했다)
    await deps.recordUsage({
      userId: source.user_id,
      projectId: source.project_id,
      eventType: "youtube_analysis",
      provider: deps.analyzer.name,
      model: deps.analyzer.model,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
    });
    // 정책 거절·잘린 출력·JSON 아님은 다시 해도 같으므로 영구 실패(재시도 없음)
    if (r.kind !== "ok") throw fail(FAILURE_CODES[r.kind]);
    results.push({ window, output: parseWindowOutput(r.output) });
  }

  await progress("chunk", 70);
  const merged = mergeWindows(results, duration, deps.analyzer.clipTimeBase);
  const chunks = chunkTranscript(merged.segments);
  if (chunks.length === 0) throw fail(INGEST_ERROR_CODES.noChunks);
  const moments = toMoments(merged.scenes, duration);
  // 버린 구간·장면 수만 남긴다(본문 없음)
  deps.log?.({
    event: "youtube_analyzed",
    jobId: job.id,
    attempt: job.attempt_count,
    chunks: chunks.length,
    windows: windows.length,
    droppedSegments: merged.droppedSegments,
    droppedScenes: merged.droppedScenes,
    moments: moments.length,
  });

  await progress("index", 85);
  signal.throwIfAborted();
  if (!(await deps.store.replaceAndComplete(job.id, job.attempt_count, chunks, moments))) throw new StaleAttemptError();
  return chunks;
}
