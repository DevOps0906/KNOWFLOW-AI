// 추출 텍스트 정규화와 쪽 단위 스캔(깨진 텍스트) 판정(task-011 구현 결정 6·7)
import { PDF_SETTINGS } from "./settings.js";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// 짝 없는 서로게이트는 Postgres jsonb·text가 거부한다
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// 한 문자(코드 포인트)씩 검사하므로 g 플래그를 쓰지 않는다(lastIndex 상태 없음)
const VALID = /[\p{Script=Hangul}\p{Script=Latin}\p{Nd}]/u;
const PUA = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const WHITESPACE = /\s/u;

/** NFC 정규화, 줄바꿈 통일, \u0000·제어문자·짝 없는 서로게이트 제거 */
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(LONE_SURROGATE, "").normalize("NFC").trim();
}

/** 공백 아닌 문자·유효 문자·PUA 문자 수(코드 포인트 단위). 중간 배열 없이 한 번 순회한다. */
export function countChars(text: string): { nonSpace: number; valid: number; pua: number } {
  let nonSpace = 0;
  let valid = 0;
  let pua = 0;
  for (const ch of text) {
    if (WHITESPACE.test(ch)) continue;
    nonSpace++;
    if (VALID.test(ch)) valid++;
    else if (PUA.test(ch)) pua++;
  }
  return { nonSpace, valid, pua };
}

/** 정규화된 쪽 텍스트가 색인할 만한 텍스트인지 판정한다. 아니면 스캔·깨진 쪽으로 보고 건너뛴다. */
export function isTextPage(text: string, settings = PDF_SETTINGS): boolean {
  const { nonSpace, valid, pua } = countChars(text);
  if (nonSpace === 0) return false;
  if (valid < settings.minValidCharsPerPage) return false;
  if (valid / nonSpace < settings.minValidCharRatio) return false;
  return pua / nonSpace <= settings.maxPuaRatio;
}
