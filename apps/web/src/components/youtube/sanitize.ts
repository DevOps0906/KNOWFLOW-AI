// 비신뢰 텍스트(전사 요약·장면 제목/설명) 정리. 서버(/moments)와 화면 양쪽에서 쓴다.
// 양방향 제어 문자(U+202A~202E, U+2066~2069, U+200E·200F, U+061C)와 zero-width(U+200B~200D, U+2060, U+FEFF), 다른 제어 문자를 지운다.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠⁦-⁩؜﻿]/g;

export function cleanUntrustedText(value: unknown): string {
  return typeof value === "string" ? value.replace(UNSAFE, "").trim() : "";
}
