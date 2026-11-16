import { PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/components/workspace/viewer/format";
import { cleanUntrustedText } from "./text";

export interface VideoSummarySentence {
  text: string;
  citations: Array<{ chunk_id: string; t_start: number }>;
}

// 영상 요약: 문장마다 근거 전사 구간의 mm:ss. 누르면 그 시각부터 재생한다.
export function VideoSummary({ sentences, onSeek }: { sentences: VideoSummarySentence[] | null; onSeek: (seconds: number) => void }) {
  return (
    <section aria-labelledby="video-summary-title" className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="video-summary-title" className="font-semibold">
          영상 요약
        </h2>
        <Badge variant="secondary">AI 요약 · AI 전사 근거</Badge>
      </div>
      {sentences === null ? (
        <p className="text-caption text-muted-foreground">아직 영상 요약이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sentences.map((s, i) => (
            <li key={i} className="flex flex-col gap-1">
              <p className="break-words">{cleanUntrustedText(s.text)}</p>
              <span className="flex flex-wrap gap-1">
                {s.citations.map((c) => (
                  <button
                    key={c.chunk_id}
                    type="button"
                    onClick={() => onSeek(c.t_start)}
                    aria-label={`${formatTimestamp(c.t_start)}부터 재생`}
                    className="inline-flex h-6 items-center gap-1 rounded-control border border-input px-2 text-caption font-semibold tabular-nums outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <PlayCircle aria-hidden className="size-3.5" />
                    {formatTimestamp(c.t_start)}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
