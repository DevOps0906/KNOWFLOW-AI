import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { processingStatus, safeExternalUrl, sourceTypeLabel, type SourceMeta } from "./format";

// S-10 머리: 경로 · 제목 · 유형 · 처리 상태 · (유튜브) 채널명·AI 전사 표시 · 원본 링크
export function SourceMetaHeader({ source }: { source: SourceMeta }) {
  const originalUrl = safeExternalUrl(source.original_url);
  const isYoutube = source.source_type === "youtube";
  return (
    <header className="flex min-w-0 flex-col gap-3">
      <nav aria-label="경로" className="text-caption text-muted-foreground">
        <Link href="/projects" className="underline underline-offset-4">
          프로젝트
        </Link>
        <span aria-hidden> › </span>
        <Link href={`/projects/${source.project_id}`} className="underline underline-offset-4">
          워크스페이스
        </Link>
        <span aria-hidden> › </span>
        <span aria-current="page">원문</span>
      </nav>
      <h1 className="text-h1 font-bold break-words">{source.title}</h1>
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <Badge variant="outline">{sourceTypeLabel(source.source_type)}</Badge>
        <StatusBadge status={processingStatus(source.status)} />
        {isYoutube && source.channel_title ? <span>채널: {source.channel_title}</span> : null}
        {isYoutube ? <Badge variant="secondary">AI 전사</Badge> : null}
        {originalUrl ? (
          <a
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
          >
            원본 보기
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </header>
  );
}
