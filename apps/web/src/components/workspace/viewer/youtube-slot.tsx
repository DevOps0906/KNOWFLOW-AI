import { PlaySquare } from "lucide-react";
import { formatTimestamp, type SourceMeta } from "./format";

// task-029 확장 지점: 공식 임베드 플레이어(startSeconds부터 재생) · 영상 요약 · 장면 카드(/moments)가 들어온다.
// 지금은 자리만 둔다. 비활성 영상에서는 렌더하지 않는다(호출부가 결정).
export function YoutubeSlot({ source, startSeconds }: { source: SourceMeta; startSeconds: number | null }) {
  return (
    <section
      aria-label="영상 플레이어와 장면 카드"
      data-slot="youtube-viewer"
      data-video-id={source.video_id ?? undefined}
      data-start-seconds={startSeconds ?? undefined}
      className="flex items-start gap-3 rounded-panel border border-dashed border-border bg-card p-4 text-muted-foreground"
    >
      <PlaySquare aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p>
        영상 플레이어와 장면 카드는 준비 중입니다.
        {startSeconds !== null ? ` 인용 위치는 ${formatTimestamp(startSeconds)}부터입니다.` : null}
      </p>
    </section>
  );
}
