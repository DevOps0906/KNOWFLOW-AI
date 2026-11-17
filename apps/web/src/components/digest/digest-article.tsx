import { useMemo } from "react";
import { cleanText } from "@/components/youtube/embed";
import { CitationChips } from "./citation-chips";
import { buildTermMatcher, TermText, type TermMatcher } from "./term-text";
import type { Digest, DigestCitation, DigestMode } from "./types";

/** 요점의 첫 문장(굵게)과 나머지 */
export function splitFirstSentence(text: string): [string, string] {
  const m = /^(.+?[.!?。])\s+([\s\S]+)$/.exec(text);
  return m ? [m[1], m[2]] : [text, ""];
}

function Lead({ text, matcher }: { text: string; matcher: TermMatcher }) {
  const [first, rest] = splitFirstSentence(text);
  return (
    <>
      <strong className="font-semibold text-heading">
        <TermText text={first} matcher={matcher} />
      </strong>
      {rest ? (
        <>
          {" "}
          <TermText text={rest} matcher={matcher} />
        </>
      ) : null}
    </>
  );
}

// 다이제스트 본문(docs/digest-contract.md §1 ⑤~⑦). 핵심 모드는 한눈에 보기·핵심 용어만, 딥 리서치는 장까지 전체.
// 모든 문장은 AI가 만든 비신뢰 텍스트: 제어 문자를 지우고 React 텍스트로만 렌더한다.
export function DigestArticle({ digest, mode, onCite }: { digest: Digest; mode: DigestMode; onCite: (c: DigestCitation) => void }) {
  const matcher = useMemo(() => buildTermMatcher(digest.terms), [digest.terms]);
  return (
    <>
      <section id="glance" data-digest-section aria-labelledby="glance-title" className="flex scroll-mt-4 flex-col gap-4">
        <h2 id="glance-title" className="text-digest-section font-semibold text-heading">
          한눈에 보기
        </h2>
        <ol className="flex list-decimal flex-col gap-3 pl-6">
          {digest.glance.map((g, i) => (
            <li key={i}>
              <p className="break-words">
                <strong className="font-semibold text-heading">
                  <TermText text={g.text} matcher={matcher} />
                </strong>
                <CitationChips citations={g.citations} onCite={onCite} />
              </p>
              {g.details.length > 0 ? (
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                  {g.details.map((d, j) => (
                    <li key={j} className="break-words">
                      <TermText text={d} matcher={matcher} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {digest.terms.length > 0 ? (
        <section id="terms" data-digest-section aria-labelledby="terms-title" className="flex scroll-mt-4 flex-col gap-3 rounded-row bg-sidebar p-4 md:p-5">
          <h2 id="terms-title" className="text-digest-section font-semibold text-heading">
            핵심 용어
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            {digest.terms.map((t, i) => (
              <li key={i} className="break-words">
                <strong className="font-semibold text-heading">{cleanText(t.term)}</strong>: {cleanText(t.desc)}
                <CitationChips citations={t.citations} onCite={onCite} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {mode === "deep"
        ? digest.chapters.map((c, i) => (
            <section key={i} id={`chapter-${i}`} data-digest-section aria-labelledby={`chapter-${i}-title`} className="flex scroll-mt-4 flex-col gap-4">
              <span aria-hidden className="grid size-7 place-items-center rounded-md bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
                {i + 1}
              </span>
              <h2 id={`chapter-${i}-title`} className="text-digest-chapter font-semibold break-words text-heading">
                {cleanText(c.title)}
                <CitationChips citations={c.citations} onCite={onCite} />
              </h2>
              {c.intro ? (
                <p className="break-words">
                  <TermText text={c.intro} matcher={matcher} />
                </p>
              ) : null}
              <ol className="flex list-decimal flex-col gap-3 pl-6">
                {c.points.map((p, j) => (
                  <li key={j}>
                    <p className="break-words">
                      <Lead text={p.text} matcher={matcher} />
                      <CitationChips citations={p.citations} onCite={onCite} />
                    </p>
                    {p.subpoints.length > 0 ? (
                      <ol className="mt-1 flex list-[lower-alpha] flex-col gap-1 pl-5">
                        {p.subpoints.map((s, k) => (
                          <li key={k} className="break-words">
                            <TermText text={s.text} matcher={matcher} />
                            <CitationChips citations={s.citations} onCite={onCite} />
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ))
        : null}
    </>
  );
}
