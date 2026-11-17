import { Fragment } from "react";
import { cleanText } from "@/components/youtube/embed";
import type { DigestTerm } from "./types";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 용어 → 설명 사전과, 긴 용어부터 찾는 정규식. 용어가 없으면 null */
export function buildTermMatcher(terms: DigestTerm[]) {
  const dict = new Map<string, string>();
  for (const t of terms) {
    const key = cleanText(t.term).trim().toLowerCase();
    if (key && !dict.has(key)) dict.set(key, cleanText(t.desc));
  }
  if (dict.size === 0) return null;
  const pattern = [...dict.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  return { dict, re: new RegExp(`(${pattern})`, "gi") };
}

export type TermMatcher = ReturnType<typeof buildTermMatcher>;

// 본문 문장(AI가 만든 비신뢰 텍스트): 제어 문자를 지우고 React 텍스트로만 렌더한다.
// 핵심 용어와 일치하는 구절은 점선 밑줄, 마우스를 올리면(title) 설명이 보인다.
export function TermText({ text, matcher }: { text: string; matcher: TermMatcher }) {
  const clean = cleanText(text);
  if (!matcher) return <>{clean}</>;
  const parts = clean.split(matcher.re);
  return (
    <>
      {parts.map((part, i) => {
        const desc = i % 2 === 1 ? matcher.dict.get(part.toLowerCase()) : undefined;
        if (desc === undefined) return <Fragment key={i}>{part}</Fragment>;
        return (
          <span key={i} data-term title={desc} className="cursor-help underline decoration-dotted underline-offset-4">
            {part}
          </span>
        );
      })}
    </>
  );
}
