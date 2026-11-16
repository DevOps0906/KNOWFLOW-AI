import { Clapperboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/components/workspace/viewer/format";
import { cleanUntrustedText } from "./text";

export interface MomentCardItem {
  id: string;
  locator: { t_start: number; t_end: number };
  title: string;
  description: string;
  citable: boolean;
}

// L0 장면 카드: AI가 영상을 보고 만든 설명이라 전사 근거가 아니다. 카드를 누르면 그 시각부터 재생한다. 썸네일 없음.
export function MomentCards({ moments, onSeek }: { moments: MomentCardItem[]; onSeek: (seconds: number) => void }) {
  return (
    <section aria-labelledby="moment-cards-title" className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="moment-cards-title" className="font-semibold">
          장면 카드
        </h2>
        <Badge variant="secondary">AI가 본 장면 · 전사 근거 아님</Badge>
      </div>
      {moments.length === 0 ? (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Clapperboard aria-hidden className="size-4 shrink-0" />이 영상에서 만든 장면 카드가 없습니다.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {moments.map((m) => {
            const range = `${formatTimestamp(m.locator.t_start)} ~ ${formatTimestamp(m.locator.t_end)}`;
            const title = cleanUntrustedText(m.title);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  data-moment-id={m.id}
                  onClick={() => onSeek(m.locator.t_start)}
                  aria-label={`${range} 재생: ${title}`}
                  className="flex w-full min-w-0 flex-col items-start gap-1 rounded-row border border-border p-3 text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="text-caption font-semibold text-muted-foreground tabular-nums">{range}</span>
                  <span className="font-semibold break-words">{title}</span>
                  <span className="text-caption break-words whitespace-pre-wrap">{cleanUntrustedText(m.description)}</span>
                  {m.citable ? null : <span className="text-caption text-warning">겹치는 전사가 없어 리포트에 인용할 수 없습니다.</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
