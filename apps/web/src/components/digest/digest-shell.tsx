"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, Clock, EyeOff, FileX, MoreHorizontal } from "lucide-react";
import { OriginalCard, useOriginalShortcut } from "@/components/report/original-card";
import { SourceCard } from "@/components/report/source-card";
import { SourceStatusCard, useSourceStatus } from "@/components/report/source-status";
import type { ReportFolder } from "@/components/report/types";
import { StateCard } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { safeExternalUrl, sourceTypeLabel, type SourceMeta } from "@/components/workspace/viewer/format";
import { SourceViewer } from "@/components/workspace/viewer/source-viewer";
import { cleanText } from "@/components/youtube/embed";
import { YoutubePanel } from "@/components/youtube/youtube-panel";
import type { Seek } from "@/components/youtube/youtube-player";
import { cn } from "@/lib/utils";
import { DigestArticle } from "./digest-article";
import { DigestToc, digestToc, ModeToggle } from "./digest-toc";
import type { DigestCitation, DigestMode } from "./types";
import { useDigest } from "./use-digest";

const CHIP = "inline-flex items-center rounded-control border border-border bg-card px-3 py-1 text-caption font-medium";

/** 다이제스트가 아직 없을 때. 재조회 시간이 지난 뒤에도 다시 시도할 수 있다 */
function EmptyDigest({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-muted-foreground break-keep">아직 요약이 없습니다.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

// 자료 결과 화면(docs/digest-contract.md §1, Readray digest). (reader) 레이아웃이라 앱 사이드바 없이 전체 폭.
// 상단: "‹ 홈" · ··· 메뉴 · 스크롤 진행 막대. 왼쪽: 핵심/딥 리서치 토글 + 목차(767 이하는 본문 위 접이식).
// 가운데: 제목 · 자료 카드 · 칩 · 한눈에 보기 · 핵심 용어 · 장(딥 리서치). 하단: "원본" 알약 + 질문 입력(준비 중).
// 처리 중·실패·비활성·폴링 401/404는 자료 상태 카드(source-status)를 그대로 쓴다.
export function DigestShell({
  initialSource,
  folder,
  initialChunkId,
  youtubeEnabled = false,
}: {
  initialSource: SourceMeta;
  folder: ReportFolder | null;
  initialChunkId: string | null;
  youtubeEnabled?: boolean;
}) {
  const { source, completed, pollError, announcement } = useSourceStatus(initialSource);
  // 인용 링크(?chunk=)로 들어오면 원문 카드를 연 채로 시작한다
  const [originalOpen, setOriginalOpen] = useState(initialChunkId !== null);
  // 원문 카드가 처음 보일 청크. 인용 칩을 누르면 바꾸고 nonce로 원문 뷰어를 새로 연다
  const [focus, setFocus] = useState({ chunkId: initialChunkId, nonce: 0 });
  const [seek, setSeek] = useState<Seek>({ seconds: null, autoplay: false, nonce: 0 });
  const [mode, setMode] = useState<DigestMode>("core");
  const [activeId, setActiveId] = useState<string | null>("glance");
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isYoutube = source.source_type === "youtube";
  const { state, reload } = useDigest(source.id, completed);
  const data = state.kind === "ok" && typeof state.data === "object" ? state.data : null;
  const digest = data && !data.unavailable && data.status === "ready" ? data.digest : null;

  const toggleOriginal = useCallback(() => setOriginalOpen((v) => !v), []);
  useOriginalShortcut(completed, toggleOriginal);

  /** 인용 칩: 원문 카드를 열고 그 청크로 옮긴다. 영상이면 그 시각부터 재생한다 */
  const cite = useCallback((c: DigestCitation) => {
    setFocus((prev) => ({ chunkId: c.chunk_id, nonce: prev.nonce + 1 }));
    const seconds = c.t_start;
    if (seconds !== null) setSeek((prev) => ({ seconds, autoplay: true, nonce: prev.nonce + 1 }));
    setOriginalOpen(true);
  }, []);

  const toc = digestToc(digest, mode);
  const tocKey = toc.map((t) => t.id).join("|");

  // 현재 장 표시: 스크롤 영역 안에서 보이는 장
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    root.querySelectorAll("[data-digest-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  };

  const selectToc = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const backToList = (
    <Button asChild variant="outline" size="sm">
      <Link href="/sources">자료 목록으로</Link>
    </Button>
  );
  const originalUrl = safeExternalUrl(source.original_url);
  const title = digest ? cleanText(digest.title) : source.title;

  const body = (() => {
    if (state.kind === "loading") {
      return (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">요약을 불러오는 중</span>
          <Skeleton aria-hidden className="h-4 w-full" />
          <Skeleton aria-hidden className="h-4 w-5/6" />
          <Skeleton aria-hidden className="h-4 w-2/3" />
        </div>
      );
    }
    if (state.kind === "error") return <ErrorState title="요약을 불러오지 못했습니다" onRetry={reload} />;
    if (state.data === "unauthorized" || state.data === "not_found") return <SourceStatusCard source={source} pollError={state.data} action={backToList} />;
    if (state.data.unavailable) {
      return (
        <StateCard
          role="status"
          tone="warning"
          icon={<EyeOff />}
          title={isYoutube ? "원본 영상을 더 이상 볼 수 없습니다" : "원본을 더 이상 볼 수 없습니다"}
          description="원본을 더 이상 볼 수 없어 요약을 숨겼습니다."
        />
      );
    }
    if (digest) return <DigestArticle digest={digest} mode={mode} onCite={cite} />;
    if (state.data.status === "failed") {
      return (
        <StateCard role="alert" tone="danger" icon={<FileX />} title="요약을 만들지 못했습니다" description="이 자료의 요약을 만드는 중 문제가 생겼습니다. 원문은 원본 버튼으로 볼 수 있습니다.">
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            다시 시도
          </Button>
        </StateCard>
      );
    }
    if (state.generating) {
      return (
        <p role="status" className="flex items-center gap-2 text-muted-foreground break-keep">
          <Clock aria-hidden className="size-4" />
          요약을 만드는 중입니다. 잠시 뒤 자동으로 보입니다.
        </p>
      );
    }
    return <EmptyDigest onRetry={reload} />;
  })();

  // 원문 카드 안 영상: YoutubePanel(플레이어·영상 요약·장면 카드·캡처 L1). 처음에는 인용 청크 시각에서 멈춘 채로 열고,
  // 인용 칩을 누르면 원문 뷰어가 새로 열리며 패널이 그 시각부터 재생한다. 플래그가 꺼지면 SourceViewer 기본(준비 중 안내).
  const renderMedia =
    isYoutube && youtubeEnabled
      ? (startSeconds: number | null) => (
          <YoutubePanel
            sourceId={source.id}
            videoId={source.video_id}
            title={source.title}
            originalUrl={originalUrl}
            startSeconds={seek.nonce === 0 ? startSeconds : seek.seconds}
            autoplay={seek.nonce > 0}
          />
        )
      : undefined;

  return (
    <div data-testid="digest-screen" className="relative flex h-dvh flex-col bg-background text-foreground">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-hidden className="h-0.5 shrink-0">
        <div data-testid="scroll-progress" className="h-full origin-left bg-lime" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 md:px-6">
        <Link href="/sources" className={cn(CHIP, "gap-0.5 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring")}>
          <ChevronLeft aria-hidden className="size-4" />홈
        </Link>
        <div className="relative">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="더 보기" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal aria-hidden />
          </Button>
          {menuOpen ? (
            <div
              className="absolute top-full right-0 z-10 mt-1 flex min-w-40 flex-col rounded-row border border-border bg-popover p-1 shadow-panel"
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuOpen(false);
              }}
            >
              {completed ? (
                <button
                  type="button"
                  className="rounded-row px-3 py-1.5 text-left text-caption hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    setOriginalOpen(true);
                  }}
                >
                  원문 보기
                </button>
              ) : null}
              {originalUrl ? (
                <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="rounded-row px-3 py-1.5 text-caption hover:bg-muted" onClick={() => setMenuOpen(false)}>
                  원본 링크 열기
                </a>
              ) : null}
              <Link href="/sources" className="rounded-row px-3 py-1.5 text-caption hover:bg-muted">
                자료 목록으로
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} data-testid="digest-scroll" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full grid-cols-1 gap-6 px-4 pt-2 pb-40 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6 desk:grid-cols-[minmax(0,1fr)_minmax(0,var(--container-reading))_minmax(0,1fr)]">
          <aside aria-label="목차 열" className="sticky top-2 hidden min-w-0 flex-col gap-4 self-start md:flex desk:w-full desk:max-w-60 desk:justify-self-end">
            {completed ? <ModeToggle mode={mode} onChange={setMode} /> : null}
            <DigestToc title={source.title} items={toc} activeId={activeId} onSelect={selectToc} />
          </aside>

          <article className="flex w-full min-w-0 flex-col gap-6 md:max-w-reading">
            {completed ? (
              <div className="flex flex-col gap-3 md:hidden">
                <ModeToggle mode={mode} onChange={setMode} />
                {toc.length > 0 ? (
                  <details className="rounded-row border border-border bg-card px-3 py-2">
                    <summary className="cursor-pointer text-digest-toc font-medium">목차</summary>
                    <div className="pt-2">
                      <DigestToc title={source.title} items={toc} activeId={activeId} onSelect={selectToc} />
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
            <h1 className="text-digest-title font-semibold break-words text-heading">{title}</h1>
            <SourceCard source={source} originalOpen={completed ? originalOpen : undefined} onToggleOriginal={completed ? toggleOriginal : undefined} />
            <div className="flex flex-wrap gap-2">
              {folder ? (
                <Link href={`/sources?folder=${encodeURIComponent(folder.id)}`} className={cn(CHIP, "hover:bg-muted")}>
                  {folder.name}
                </Link>
              ) : null}
              <span className={CHIP}>{sourceTypeLabel(source.source_type)}</span>
            </div>
            <hr className="border-t-2 border-foreground" />
            {completed ? body : <SourceStatusCard source={source} pollError={pollError} action={backToList} />}
          </article>
        </div>
      </div>

      {completed ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-3 md:px-6">
          <div className="pointer-events-auto mx-auto flex w-full max-w-reading flex-col gap-1">
            <div className="flex items-center gap-2 rounded-control border border-border bg-card p-1.5 shadow-panel">
              <button
                type="button"
                aria-pressed={originalOpen}
                onClick={toggleOriginal}
                className="inline-flex shrink-0 items-center gap-1 rounded-control bg-secondary px-3 py-1.5 text-caption font-medium outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <BookOpen aria-hidden className="size-4" />
                원본
              </button>
              <input
                type="text"
                disabled
                aria-label="이 자료에 질문하기(준비 중)"
                placeholder="이 자료에 질문하기 · 준비 중"
                className="min-w-0 flex-1 bg-transparent px-2 text-body outline-none placeholder:text-faint disabled:cursor-not-allowed"
              />
            </div>
            <p className="text-center text-label text-faint">AI 요약은 틀릴 수 있습니다. 인용 칩을 눌러 원문으로 확인하세요.</p>
          </div>
        </div>
      ) : null}

      {completed && originalOpen ? (
        <OriginalCard pinned={false} onClose={() => setOriginalOpen(false)}>
          <SourceViewer
            key={`${source.id}:${focus.chunkId ?? ""}:${focus.nonce}`}
            source={source}
            initialChunkId={focus.chunkId}
            youtubeEnabled={youtubeEnabled}
            renderMedia={renderMedia}
          />
        </OriginalCard>
      ) : null}
    </div>
  );
}
