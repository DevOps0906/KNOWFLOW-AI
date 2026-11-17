import type { ReactNode } from "react";
import { Play, Sparkles } from "lucide-react";
import { formatTimestamp } from "@/components/workspace/viewer/format";
import { cleanText, type MomentItem } from "./embed";

// L0 장면 카드: 시각·제목·설명·"AI가 본 장면, 전사 근거 아님". 클릭하면 그 시각부터 재생한다. 썸네일은 두지 않는다.
// 제목·설명은 비신뢰 텍스트: 제어 문자를 지우고 React 텍스트로만 렌더한다.
// renderAction: 카드 아래 추가 동작(task-030 캡처 버튼). 카드 버튼 안에 넣지 않는다(버튼 중첩 금지).
export function MomentCards({
  items,
  onPlay,
  renderAction,
  embedded = false,
}: {
  items: MomentItem[];
  onPlay: (seconds: number) => void;
  renderAction?: (moment: MomentItem) => ReactNode;
  /** 자료 결과 리포트 안에 넣을 때: 제목은 리포트 장이 맡고, 리포트 단이 좁아 2열까지만 */
  embedded?: boolean;
}) {
  const Root = embedded ? "div" : "section";
  return (
    <Root aria-labelledby={embedded ? undefined : "moment-cards-title"} className="flex min-w-0 flex-col gap-3">
      {embedded ? null : (
        <h2 id="moment-cards-title" className="text-h2 font-bold">
          장면 카드
        </h2>
      )}
      {items.length === 0 ? (
        <p role="status" className="rounded-row bg-muted p-3 text-caption text-muted-foreground">
          이 영상에서 만든 장면 카드가 없습니다.
        </p>
      ) : (
        <ol className={embedded ? "grid grid-cols-1 gap-3 md:grid-cols-2" : "grid grid-cols-1 gap-3 md:grid-cols-2 desk:grid-cols-3"}>
          {items.map((m) => {
            const start = formatTimestamp(m.locator.t_start);
            const title = cleanText(m.title);
            return (
              <li key={m.id} className="flex min-w-0 flex-col gap-2">
                <button
                  type="button"
                  data-moment-id={m.id}
                  onClick={() => onPlay(m.locator.t_start)}
                  className="flex w-full flex-1 flex-col items-start gap-2 rounded-panel border border-border bg-card p-4 text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="inline-flex items-center gap-1 text-caption font-semibold text-primary tabular-nums">
                    <Play aria-hidden className="size-3.5" />
                    {start} ~ {formatTimestamp(m.locator.t_end)}
                  </span>
                  <span className="font-semibold break-words">{title}</span>
                  <span className="text-caption break-words text-muted-foreground">{cleanText(m.description)}</span>
                  <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                    <Sparkles aria-hidden className="size-3.5" />
                    AI가 본 장면, 전사 근거 아님
                  </span>
                  {m.citable ? null : (
                    <span className="text-caption text-warning">겹치는 전사 구간이 없어 리포트에 인용할 수 없습니다</span>
                  )}
                </button>
                {renderAction?.(m)}
              </li>
            );
          })}
        </ol>
      )}
    </Root>
  );
}
