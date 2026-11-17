import { BookOpen, ExternalLink, FileText, Globe, Play } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatTimestamp, processingStatus, safeExternalUrl, sourceTypeLabel, type SourceMeta } from "@/components/workspace/viewer/format";

function ThumbIcon({ type }: { type: string }) {
  if (type === "youtube") return <Play className="size-6" />;
  if (type === "url") return <Globe className="size-6" />;
  return <FileText className="size-6" />;
}

// 자료 카드(Readray ③): 왼쪽 16:9 썸네일 · 제목 · 고정폭 메타 줄 · 오른쪽 "원문 보기".
// 썸네일은 외부 이미지를 쓰지 않고 유형 아이콘으로 그린다. 제목·채널명은 React 텍스트로만 렌더한다.
export function SourceCard({
  source,
  originalOpen,
  onToggleOriginal,
}: {
  source: SourceMeta;
  originalOpen?: boolean;
  /** 없으면 "원문 보기"를 숨긴다(처리 중·실패) */
  onToggleOriginal?: () => void;
}) {
  const originalUrl = safeExternalUrl(source.original_url);
  const meta = [
    sourceTypeLabel(source.source_type),
    source.source_type === "youtube" && source.channel_title ? source.channel_title : null,
    source.duration_seconds ? formatTimestamp(source.duration_seconds) : null,
    source.created_at.slice(0, 10),
  ].filter((v): v is string => Boolean(v));

  return (
    <section aria-label="자료 정보" className="flex min-w-0 flex-wrap items-center gap-3 rounded-panel border border-border bg-card p-3 md:flex-nowrap md:gap-4">
      <div aria-hidden className="grid aspect-video w-24 shrink-0 place-items-center rounded-row bg-muted text-muted-foreground md:w-32">
        <ThumbIcon type={source.source_type} />
      </div>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <p className="font-semibold break-words">{source.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground tabular-nums">
          {meta.map((m, i) => (
            <span key={i}>
              {i > 0 ? <span aria-hidden>· </span> : null}
              {m}
            </span>
          ))}
          {source.status === "completed" ? null : <StatusBadge status={processingStatus(source.status)} />}
          {source.source_type === "youtube" ? <span>AI 전사</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {originalUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a href={originalUrl} target="_blank" rel="noopener noreferrer">
              원본 링크
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </Button>
        ) : null}
        {onToggleOriginal ? (
          <Button type="button" variant="outline" size="sm" aria-pressed={originalOpen} onClick={onToggleOriginal}>
            <BookOpen aria-hidden />
            원문 보기
          </Button>
        ) : null}
      </div>
    </section>
  );
}
