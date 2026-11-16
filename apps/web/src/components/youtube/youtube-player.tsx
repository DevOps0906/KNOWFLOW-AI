import { ExternalLink } from "lucide-react";
import { embedSrc } from "./embed";

/** 재생 요청. nonce가 바뀌면 같은 시각이어도 iframe을 다시 연다 */
export interface Seek {
  seconds: number | null;
  autoplay: boolean;
  nonce: number;
}

// 공식 임베드 플레이어(youtube-nocookie). 시각 이동은 src 교체로만 한다. referrerpolicy는 기본값을 둔다.
// video_id가 11자 규칙에 맞지 않으면 iframe 대신 원본 링크를 보여 준다.
export function YoutubePlayer({
  videoId,
  title,
  seek,
  originalUrl,
}: {
  videoId: string | null;
  title: string;
  seek: Seek;
  originalUrl: string | null;
}) {
  const src = embedSrc(videoId, seek.seconds, seek.autoplay);
  if (!src) {
    return (
      <div role="status" className="flex flex-col items-start gap-2 rounded-panel border border-border bg-muted p-4 text-muted-foreground">
        <p>이 영상은 여기서 재생할 수 없습니다.</p>
        {originalUrl ? (
          <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-4">
            원본에서 보기
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <div className="aspect-video w-full overflow-hidden rounded-panel border border-border bg-muted">
      <iframe
        key={seek.nonce}
        src={src}
        title={`유튜브 플레이어: ${title}`}
        className="size-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}
