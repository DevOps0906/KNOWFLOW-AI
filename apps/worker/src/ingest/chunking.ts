// 쪽별 텍스트 → 청크(task-011 구현 결정 8). 같은 입력이면 항상 같은 청크(chunk_index 포함)를 만든다(재처리 멱등).
import type { PdfPage } from "../pdf/parser.js";
import { CHUNK_SETTINGS } from "./settings.js";

export interface ChunkLocator {
  page: number;
  /** 쪽 텍스트(정규화 후) 안의 시작·끝 위치 */
  char_start: number;
  char_end: number;
}

export interface ChunkDraft {
  chunk_index: number;
  content: string;
  locator: ChunkLocator;
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

export function chunkPages(pages: PdfPage[], settings: ChunkSettings = CHUNK_SETTINGS): ChunkDraft[] {
  const { maxChars, overlapChars, minChars } = settings;
  if (!(overlapChars >= 0 && overlapChars * 2 < maxChars && minChars > overlapChars && minChars <= maxChars)) {
    throw new Error("청크 설정이 올바르지 않습니다");
  }
  const out: ChunkDraft[] = [];
  for (const { page, text } of pages) {
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
      out.push({
        chunk_index: out.length,
        content: text.slice(start, contentEnd),
        locator: { page, char_start: start, char_end: contentEnd },
      });
      if (end >= len) break;
      let next = end - overlapChars;
      if (next <= start) next = end;
      if (next > 0 && next < len && isHighSurrogate(text.charCodeAt(next - 1))) next++;
      start = next;
    }
  }
  return out;
}
