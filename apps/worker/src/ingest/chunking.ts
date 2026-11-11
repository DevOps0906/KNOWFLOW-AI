// 쪽별 텍스트·전사 구간 → 청크(task-011 구현 결정 8, task-028). 같은 입력이면 항상 같은 청크(chunk_index 포함)를 만든다(재처리 멱등).
import type { PdfPage } from "../pdf/parser.js";
import { CHUNK_SETTINGS } from "./settings.js";

export interface ChunkLocator {
  page: number;
  /** 쪽 텍스트(정규화 후) 안의 시작·끝 위치 */
  char_start: number;
  char_end: number;
}

/** 유튜브 전사 청크의 위치(초). 청크가 걸친 첫 구간의 시작 ~ 마지막 구간의 끝 */
export interface TimeLocator {
  t_start: number;
  t_end: number;
}

export interface ChunkDraft<L = ChunkLocator> {
  chunk_index: number;
  content: string;
  locator: L;
}

/** 시각 검증을 통과한 전사 구간(시간순·겹침 없음, 텍스트는 정규화됨) */
export interface TranscriptSegment {
  t_start: number;
  t_end: number;
  text: string;
}

type ChunkSettings = { maxChars: number; overlapChars: number; minChars: number };

const SPACE = /\s/;
// 우선순위: 빈 줄 → 줄바꿈 → 문장 끝 → 공백
const BREAKS: RegExp[] = [/\n\s*\n/g, /\n/g, /[.!?。]\s/g, /\s/g];

/** [from, to) 안에서 가장 뒤쪽의 끊을 자리(구분자 바로 뒤). 없으면 -1 */
function breakAt(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  for (const re of BREAKS) {
    let last = -1;
    for (const m of window.matchAll(re)) last = m.index + m[0].length;
    if (last > 0) return from + last;
  }
  return -1;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function checkSettings({ maxChars, overlapChars, minChars }: ChunkSettings) {
  if (!(overlapChars >= 0 && overlapChars * 2 < maxChars && minChars > overlapChars && minChars <= maxChars)) {
    throw new Error("청크 설정이 올바르지 않습니다");
  }
}

/** 텍스트 하나를 겹치는 조각 [start, end)로 나눈다(앞뒤 공백 제외). */
function splitText(text: string, settings: ChunkSettings): { start: number; end: number }[] {
  const { maxChars, overlapChars, minChars } = settings;
  const out: { start: number; end: number }[] = [];
  const len = text.length;
  let start = 0;
  while (start < len) {
    while (start < len && SPACE.test(text[start]!)) start++;
    if (start >= len) break;
    let end = Math.min(len, start + maxChars);
    if (end < len) {
      const b = breakAt(text, start + minChars, end);
      if (b > start) end = b;
      // 서로게이트 쌍을 가르지 않는다
      else if (isHighSurrogate(text.charCodeAt(end - 1))) end--;
    }
    let contentEnd = end;
    while (contentEnd > start && SPACE.test(text[contentEnd - 1]!)) contentEnd--;
    out.push({ start, end: contentEnd });
    if (end >= len) break;
    let next = end - overlapChars;
    if (next <= start) next = end;
    if (next > 0 && next < len && isHighSurrogate(text.charCodeAt(next - 1))) next++;
    start = next;
  }
  return out;
}

export function chunkPages(pages: PdfPage[], settings: ChunkSettings = CHUNK_SETTINGS): ChunkDraft[] {
  checkSettings(settings);
  const out: ChunkDraft[] = [];
  for (const { page, text } of pages) {
    for (const { start, end } of splitText(text, settings)) {
      out.push({ chunk_index: out.length, content: text.slice(start, end), locator: { page, char_start: start, char_end: end } });
    }
  }
  return out;
}

/** 위치 pos를 담은(또는 pos 앞의 마지막) 구간 번호. starts는 오름차순 */
function segmentAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 전사 구간 → 청크(task-028). 구간을 줄바꿈으로 이어 붙인 한 텍스트를 쪽과 같은 규칙으로 나누고,
 * locator에는 청크가 걸친 첫 구간의 t_start ~ 마지막 구간의 t_end를 적는다.
 */
export function chunkTranscript(segments: TranscriptSegment[], settings: ChunkSettings = CHUNK_SETTINGS): ChunkDraft<TimeLocator>[] {
  checkSettings(settings);
  const starts: number[] = [];
  let text = "";
  for (const s of segments) {
    if (starts.length > 0) text += "\n";
    starts.push(text.length);
    text += s.text;
  }
  return splitText(text, settings).map(({ start, end }, chunk_index) => ({
    chunk_index,
    content: text.slice(start, end),
    locator: { t_start: segments[segmentAt(starts, start)]!.t_start, t_end: segments[segmentAt(starts, end - 1)]!.t_end },
  }));
}
