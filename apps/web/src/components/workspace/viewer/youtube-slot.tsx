import { YoutubeDisabledNotice, YoutubePanel } from "@/components/youtube/youtube-panel";
import { safeExternalUrl, type SourceMeta } from "./format";

// S-10 유튜브 영역(task-029b): 플래그가 켜져 있으면 임베드 플레이어(startSeconds부터)·영상 요약·장면 카드,
// 꺼져 있으면 "유튜브 기능 준비 중"만. 비활성 영상에서는 렌더하지 않는다(호출부가 결정).
export function YoutubeSlot({
  source,
  startSeconds,
  enabled,
}: {
  source: SourceMeta;
  startSeconds: number | null;
  enabled: boolean;
}) {
  if (!enabled) return <YoutubeDisabledNotice />;
  return (
    <YoutubePanel
      sourceId={source.id}
      videoId={source.video_id}
      title={source.title}
      originalUrl={safeExternalUrl(source.original_url)}
      startSeconds={startSeconds}
    />
  );
}
