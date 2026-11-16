import { YoutubePanel } from "@/components/youtube/youtube-panel";
import type { SourceMeta } from "./format";

// S-10 영상 영역 연결(task-029b). 비활성 영상에서는 렌더하지 않는다(호출부가 결정).
export function YoutubeSlot({
  source,
  startSeconds,
  enabled,
}: {
  source: SourceMeta;
  startSeconds: number | null;
  enabled: boolean;
}) {
  return <YoutubePanel source={source} startSeconds={startSeconds} enabled={enabled} />;
}
