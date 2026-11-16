import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/components/workspace/viewer/format";
import { cleanText, type SummarySentence } from "./embed";

// 영상 요약: 문장마다 인용한 전사 구간의 mm:ss를 두고, 누르면 그 시각부터 재생한다.
// 요약은 AI가 만든 비신뢰 텍스트: 제어 문자를 지우고 React 텍스트로만 렌더한다.
export function VideoSummary({ sentences, onPlay }: { sentences: SummarySentence[]; onPlay: (seconds: number) => void }) {
  return (
    <section aria-labelledby="video-summary-title" className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="video-summary-title" className="text-h2 font-bold">
          영상 요약
        </h2>
        <span className="text-caption text-muted-foreground">AI 전사를 바탕으로 AI가 요약했습니다</span>
      </div>
      <ul className="flex flex-col gap-3">
        {sentences.map((s, i) => {
          const times = [...new Set(s.citations.map((c) => c.t_start).filter((t): t is number => t !== null))];
          return (
            <li key={i} className="flex flex-col gap-1">
              <p className="break-words">{cleanText(s.text)}</p>
              {times.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {times.map((t) => (
                    <Button key={t} type="button" variant="outline" size="xs" className="tabular-nums" onClick={() => onPlay(t)}>
                      {formatTimestamp(t)}
                      <span className="sr-only">부터 재생</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
