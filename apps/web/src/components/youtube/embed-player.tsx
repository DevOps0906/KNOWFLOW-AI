import { ExternalLink, PlaySquare } from "lucide-react";
import { safeExternalUrl } from "@/components/workspace/viewer/format";
import { embedUrl } from "./text";

/** 원본 링크(유튜브에서 보기). http(s)만 연다 */
function OriginalLink({ url, children }: { url: string | null; children: React.ReactNode }) {
  const href = safeExternalUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-4">
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  ) : null;
}

// S-10 공식 임베드 플레이어. 썸네일·IFrame API 없음, referrerpolicy는 브라우저 기본값을 쓴다.
// playKey가 바뀌면 iframe을 새로 만들어 같은 시각을 다시 눌러도 그 시각부터 재생한다.
export function EmbedPlayer({
  videoId,
  title,
  originalUrl,
  start,
  autoplay,
  playKey,
}: {
  videoId: string | null;
  title: string;
  originalUrl: string | null;
  start: number | null;
  autoplay: boolean;
  playKey: number;
}) {
  const src = embedUrl(videoId, start, autoplay);
  if (!src) {
    return (
      <div role="status" className="flex flex-col items-start gap-2 rounded-panel border border-border bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          <PlaySquare aria-hidden className="size-5 shrink-0" />이 화면에서 영상을 재생할 수 없습니다.
        </p>
        <OriginalLink url={originalUrl}>유튜브에서 보기</OriginalLink>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video w-full overflow-hidden rounded-panel border border-border bg-black">
        <iframe
          key={playKey}
          src={src}
          title={`${title} 영상 플레이어`}
          className="size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <p className="text-caption text-muted-foreground">
        유튜브 공식 플레이어로 재생합니다. 재생이 안 되면 <OriginalLink url={originalUrl}>원본에서 보기</OriginalLink>
      </p>
    </div>
  );
}
