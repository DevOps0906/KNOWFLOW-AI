import { Button } from "@/components/ui/button";
import { cleanText } from "@/components/youtube/embed";
import type { SourceSummarySentence } from "./types";

// PDF 자료 요약: 문장마다 인용한 청크의 쪽(p.N) 칩을 두고, 누르면 원문 카드를 그 청크(쪽)에서 연다.
// 요약은 AI가 만든 비신뢰 텍스트: 제어 문자를 지우고 React 텍스트로만 렌더한다.
// 같은 쪽을 여러 청크가 인용하면 첫 청크 하나만 칩으로 둔다. 쪽을 모르는 인용은 칩을 만들지 않는다.
export function SourceSummary({ sentences, onCite }: { sentences: SourceSummarySentence[]; onCite: (chunkId: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-caption text-muted-foreground">이 문서를 바탕으로 AI가 요약했습니다</span>
      <ul className="flex flex-col gap-3">
        {sentences.map((s, i) => {
          const pages = new Map<number, string>();
          for (const c of s.citations) if (c.page !== null && !pages.has(c.page)) pages.set(c.page, c.chunk_id);
          return (
            <li key={i} className="flex flex-col gap-1">
              <p className="font-serif text-reading leading-reading break-words">{cleanText(s.text)}</p>
              {pages.size > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {[...pages].map(([page, chunkId]) => (
                    <Button key={page} type="button" variant="outline" size="xs" className="tabular-nums" onClick={() => onCite(chunkId)}>
                      p.{page}
                      <span className="sr-only"> 원문 보기</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
