import { PlaySquare } from "lucide-react";
import { YoutubeDisabledNotice, YoutubePanel } from "@/components/youtube/youtube-panel";
import { type SourceMeta } from "./format";

// task-029: 공식 임베드 플레이어(startSeconds부터) · 영상 요약 · 장면 카드(/moments).
// 기능 플래그가 꺼지면 "유튜브 기능 준비 중"만 보인다. 비활성 영상에서는 렌더하지 않는다(호출부가 결정).
export function YoutubeSlot({
  source,
  startSeconds,
  youtubeEnabled = false,
  captureEnabled = false,
}: {
  source: SourceMeta;
  startSeconds: number | null;
  youtubeEnabled?: boolean;
  /** L1 탭 캡처 플래그(task-030). 유튜브 플래그와 별도, 기본 꺼짐 */
  captureEnabled?: boolean;
}) {
  return (
    <section
      aria-label="영상 플레이어와 장면 카드"
      data-slot="youtube-viewer"
      data-video-id={source.video_id ?? undefined}
      data-start-seconds={startSeconds ?? undefined}
      className="min-w-0"
    >
      {youtubeEnabled ? (
        <YoutubePanel
          sourceId={source.id}
          videoId={source.video_id}
          title={source.title}
          originalUrl={source.original_url}
          initialStart={startSeconds}
          captureEnabled={captureEnabled}
        />
      ) : (
        <div className="flex items-start gap-3 rounded-panel border border-dashed border-border bg-card p-4">
          <PlaySquare aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <YoutubeDisabledNotice />
        </div>
      )}
    </section>
  );
}
