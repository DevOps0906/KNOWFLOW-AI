"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, EyeOff, FileX, LogIn, MessageSquare, SearchX } from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { StateCard } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutMode } from "@/components/workspace/use-layout-mode";
import { usePolling } from "@/components/workspace/use-polling";
import { processingStatus, type SourceMeta } from "@/components/workspace/viewer/format";
import { SourceViewer } from "@/components/workspace/viewer/source-viewer";
import { CaptureButton, CaptureList, CapturePreviewDialog } from "@/components/youtube/capture/capture-ui";
import { MomentCards } from "@/components/youtube/moment-cards";
import { VideoSummary } from "@/components/youtube/video-summary";
import { YoutubeDisabledNotice } from "@/components/youtube/youtube-panel";
import { YoutubePlayer } from "@/components/youtube/youtube-player";
import { cn } from "@/lib/utils";
import { OriginalCard } from "./original-card";
import { ReportToc, tocNumber } from "./report-toc";
import { SourceCard } from "./source-card";
import { SourceSummary } from "./source-summary";
import { isProcessing, type ReportFolder, type TocItem } from "./types";
import { useSourceSummary } from "./use-source-summary";
import { useVideoReport } from "./use-video-report";

// 자료 결과 화면(DESIGN.md §2-1 "자료 결과", Readray ③④⑤). PDF·유튜브 모두 이 화면 하나.
// 처리 중: 진행 상태 + A-07 GET 폴링(끝나면 서버 렌더를 새로 받아 요약을 읽는다).
// 요약 장은 그 자료의 요약만 보인다(PDF: /summary, 유튜브: /moments). 없으면 빈 상태이고 폴더 요약으로 대체하지 않는다.
// 완료: 데스크톱 목차 | 세리프 리포트 | 채팅, 원문은 떠 있는 카드(O 키·"원문 보기"), 고정하면 원문 | 리포트 | 채팅 3단.
// 태블릿: 리포트 | 채팅(목차는 리포트 위 가로 줄, 고정 없음). 모바일: 리포트 한 열 + 채팅 하단 시트.

const PANEL = "min-h-0 min-w-0 overflow-y-auto rounded-panel border border-border bg-card p-4 shadow-panel";

function ReportSection({ id, index, title, children }: { id: string; index: number; title: string; children: ReactNode }) {
  return (
    <section id={id} data-report-section aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-4 border-t-2 border-foreground pt-4">
      <h2 id={`${id}-title`} className="flex items-center gap-3 font-serif text-h2 font-bold">
        <span aria-hidden className="rounded-sm bg-foreground px-1.5 text-caption text-background tabular-nums">
          {tocNumber(index)}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 요약이 없을 때. 재조회 시간이 지난 뒤에도 다시 시도할 수 있다 */
function EmptySummary({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-muted-foreground break-keep">아직 요약이 없습니다.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

/** 완료 직후 요약이 저장되기 전(재조회 중) */
function SummaryGenerating() {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground break-keep">
      <Clock aria-hidden className="size-4" />
      요약을 만드는 중입니다. 잠시 뒤 자동으로 보입니다.
    </p>
  );
}

function SummaryLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden className="h-4 w-full" />
      <Skeleton aria-hidden className="h-4 w-5/6" />
      <Skeleton aria-hidden className="h-4 w-2/3" />
    </div>
  );
}

/** 입력 중에는 단축키를 무시한다 */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ReportShell({
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
  const router = useRouter();
  const mode = useLayoutMode();
  const [source, setSource] = useState(initialSource);
  const [prevInitial, setPrevInitial] = useState(initialSource);
  // 인용 링크(?chunk=)로 들어오면 원문 카드를 연 채로 시작한다
  const [originalOpen, setOriginalOpen] = useState(initialChunkId !== null);
  // 원문 카드가 처음 보일 청크. 요약의 쪽 칩을 누르면 바꾸고 nonce로 원문 뷰어를 새로 연다
  const [focus, setFocus] = useState({ chunkId: initialChunkId, nonce: 0 });
  const [pinned, setPinned] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>("summary");
  const [announcement, setAnnouncement] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  // 서버가 새로 렌더하면(router.refresh) 그 값으로 바꾼다
  if (initialSource !== prevInitial) {
    setPrevInitial(initialSource);
    setSource(initialSource);
  }

  const processing = isProcessing(source.status);
  const sourceId = source.id;
  // 폴링 중 401(세션 만료)·404(삭제·권한 없음)는 다시 물어도 같으므로 폴링을 멈추고 안내한다
  const [pollError, setPollError] = useState<"unauthorized" | "not_found" | null>(null);
  const refetch = useCallback(async () => {
    const res = await fetch(`/api/sources/${sourceId}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 404) {
      setPollError(res.status === 401 ? "unauthorized" : "not_found");
      setAnnouncement(res.status === 401 ? "로그인이 필요해 상태 확인을 멈췄습니다." : "자료를 찾을 수 없어 상태 확인을 멈췄습니다.");
      return;
    }
    if (!res.ok) throw new Error("source_failed");
    const next = ((await res.json()) as { source: SourceMeta }).source;
    setSource(next);
    if (!isProcessing(next.status)) {
      // 끝났으면 서버 렌더(폴더 요약·추천 질문 포함)를 새로 받는다
      setAnnouncement(next.status === "completed" ? "처리가 끝났습니다. 요약 리포트를 불러옵니다." : "자료를 처리하지 못했습니다.");
      router.refresh();
    }
  }, [sourceId, router]);
  usePolling(processing && pollError === null, refetch, source.status);

  const completed = source.status === "completed" && source.unavailable_at === null;
  const isYoutube = source.source_type === "youtube";
  const openOriginal = useCallback(() => setOriginalOpen(true), []);
  const video = useVideoReport(source.id, completed && isYoutube && youtubeEnabled, openOriginal);
  const videoData = video.state.kind === "ok" ? video.state.data : null;
  const videoReady = videoData?.enabled === true && !videoData.unavailable ? videoData : null;
  const pdfSummary = useSourceSummary(source.id, completed && source.source_type === "pdf");
  /** 요약의 쪽 칩: 원문 카드를 열고 그 청크(쪽)로 옮긴다 */
  const cite = useCallback((chunkId: string) => {
    setFocus((prev) => ({ chunkId, nonce: prev.nonce + 1 }));
    setOriginalOpen(true);
  }, []);

  // O 키로 원문 카드를 연다·닫는다
  useEffect(() => {
    if (!completed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      setOriginalOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [completed]);

  const toc: TocItem[] = [{ id: "summary", label: isYoutube ? "영상 요약" : "요약" }];
  if (videoReady) toc.push({ id: "scenes", label: "장면 카드" });
  const tocKey = toc.map((t) => t.id).join("|");

  // 현재 장 표시: 리포트 단 안에서 보이는 장
  useEffect(() => {
    const root = reportRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    root.querySelectorAll("[data-report-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocKey, completed]);

  const selectToc = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const backToList = (
    <Button asChild variant="outline" size="sm">
      <Link href="/sources">자료 목록으로</Link>
    </Button>
  );

  const breadcrumb = (
    <nav aria-label="경로" className="text-caption text-muted-foreground">
      <Link href="/sources" className="underline underline-offset-4">
        자료
      </Link>
      {folder ? (
        <>
          <span aria-hidden> › </span>
          <Link href={`/sources?folder=${encodeURIComponent(folder.id)}`} className="underline underline-offset-4">
            {folder.name}
          </Link>
        </>
      ) : null}
    </nav>
  );
  const title = <h1 className="font-serif text-display leading-tight font-bold break-words">{source.title}</h1>;
  const live = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  // 처리 중·실패·비활성: 리포트 대신 상태 카드
  if (!completed) {
    const failed = source.status === "failed";
    const unavailable = source.unavailable_at !== null;
    return (
      <div className="mx-auto flex w-full max-w-reading min-w-0 flex-col gap-6 p-4 md:p-6">
        {live}
        {breadcrumb}
        {title}
        <SourceCard source={source} />
        {pollError === "unauthorized" ? (
          <StateCard
            role="alert"
            tone="danger"
            icon={<LogIn />}
            title="다시 로그인해 주세요"
            description="로그인이 끝나 처리 상태를 확인할 수 없습니다. 로그인하면 이 자료로 돌아옵니다."
          >
            <Button asChild size="sm">
              <Link href={`/login?next=${encodeURIComponent(`/sources/${source.id}`)}`}>로그인</Link>
            </Button>
          </StateCard>
        ) : pollError === "not_found" ? (
          <StateCard
            role="alert"
            tone="danger"
            icon={<SearchX />}
            title="자료를 찾을 수 없습니다"
            description="삭제되었거나 볼 수 없는 자료입니다. 처리 상태 확인을 멈췄습니다."
          >
            {backToList}
          </StateCard>
        ) : unavailable ? (
          <StateCard
            role="status"
            tone="warning"
            icon={<EyeOff />}
            title={isYoutube ? "원본 영상을 더 이상 볼 수 없습니다" : "원본을 더 이상 볼 수 없습니다"}
            description="원본을 더 이상 볼 수 없어 요약과 원문을 숨겼습니다. 자료 정보만 보여 드립니다."
          >
            {backToList}
          </StateCard>
        ) : failed ? (
          <StateCard
            role="alert"
            tone="danger"
            icon={<FileX />}
            title="처리하지 못한 자료입니다"
            description={source.error_message ?? "자료를 처리하지 못했습니다. 자료 목록에서 다시 시도해 주세요."}
          >
            {backToList}
          </StateCard>
        ) : (
          <StateCard
            role="status"
            icon={<Clock />}
            title="자료를 분석하고 있습니다"
            description="원문을 읽고 요약을 만드는 중입니다. 끝나면 이 화면이 요약 리포트로 바뀝니다. 상태는 자동으로 새로 고칩니다."
          >
            <StatusBadge status={processingStatus(source.status)} />
          </StateCard>
        )}
      </div>
    );
  }

  const pinnedLayout = pinned && originalOpen && mode === "desktop";

  const summaryBody = (() => {
    if (!isYoutube) {
      if (pdfSummary.state.kind === "loading") return <SummaryLoading label="요약을 불러오는 중" />;
      if (pdfSummary.state.kind === "error") return <ErrorState title="요약을 불러오지 못했습니다" onRetry={pdfSummary.reload} />;
      const summary = pdfSummary.state.data.summary;
      if (summary) return <SourceSummary sentences={summary.sentences} onCite={cite} />;
      return pdfSummary.state.generating ? <SummaryGenerating /> : <EmptySummary onRetry={pdfSummary.reload} />;
    }
    if (!youtubeEnabled) return <YoutubeDisabledNotice />;
    if (video.state.kind === "loading") return <SummaryLoading label="요약과 장면 카드를 불러오는 중" />;
    if (video.state.kind === "error") return <ErrorState title="요약과 장면 카드를 불러오지 못했습니다" onRetry={video.reload} />;
    if (videoData && !videoData.enabled) return <YoutubeDisabledNotice />;
    if (videoData?.unavailable) {
      return (
        <StateCard
          role="status"
          tone="warning"
          icon={<EyeOff />}
          title="원본 영상을 더 이상 볼 수 없습니다"
          description="원본 영상을 더 이상 볼 수 없어 플레이어·요약·장면 카드를 숨겼습니다."
        />
      );
    }
    if (videoReady?.summary) return <VideoSummary embedded sentences={videoReady.summary.sentences} onPlay={video.play} />;
    return video.state.kind === "ok" && video.state.generating ? <SummaryGenerating /> : <EmptySummary onRetry={video.reload} />;
  })();

  const captures = video.captures;
  const capturesFull = captures.state.kind === "ok" && captures.state.data.items.length >= captures.state.data.limit;

  const report = (
    <article className="mx-auto flex w-full max-w-reading min-w-0 flex-col gap-8 pb-8">
      <div className="flex flex-col gap-4">
        {title}
        <SourceCard source={source} originalOpen={originalOpen} onToggleOriginal={() => setOriginalOpen((v) => !v)} />
      </div>
      <div className={pinnedLayout ? undefined : "desk:hidden"}>
        <ReportToc title={source.title} items={toc} activeId={activeId} onSelect={selectToc} variant="inline" />
      </div>
      <ReportSection id="summary" index={0} title={toc[0].label}>
        {summaryBody}
      </ReportSection>
      {videoReady ? (
        <ReportSection id="scenes" index={1} title="장면 카드">
          <MomentCards
            embedded
            items={videoReady.items}
            onPlay={video.play}
            renderAction={
              captures.state.kind === "ok"
                ? (m) => <CaptureButton title={m.title} disabled={captures.busy} full={capturesFull} onCapture={() => void video.capture(m)} />
                : undefined
            }
          />
          <CaptureList
            state={captures.state}
            busy={captures.busy}
            message={captures.preview ? null : captures.message}
            onRetry={captures.reload}
            onRemove={(id) => void captures.remove(id)}
          />
          <CapturePreviewDialog
            preview={captures.preview}
            busy={captures.busy}
            message={captures.message}
            onSave={() => void captures.save()}
            onCancel={captures.cancelPreview}
          />
        </ReportSection>
      ) : null}
    </article>
  );

  // 원문 카드 안 영상: 플레이어만(요약·장면 카드는 리포트에). 처음에는 인용 청크 시각에서 멈춘 채로 연다
  const renderMedia =
    isYoutube && youtubeEnabled
      ? (startSeconds: number | null) => {
          if (videoData && (!videoData.enabled || videoData.unavailable)) return videoData.enabled ? null : <YoutubeDisabledNotice />;
          const seek = video.seek.nonce === 0 ? { seconds: startSeconds, autoplay: false, nonce: 0 } : video.seek;
          return (
            <div ref={video.playerRef} data-slot="capture-target">
              <YoutubePlayer videoId={source.video_id} title={source.title} seek={seek} originalUrl={source.original_url} />
            </div>
          );
        }
      : undefined;

  const original = originalOpen ? (
    <OriginalCard pinned={pinnedLayout} onTogglePin={() => setPinned((v) => !v)} onClose={() => setOriginalOpen(false)}>
      <SourceViewer
        key={`${source.id}:${focus.chunkId ?? ""}:${focus.nonce}`}
        source={source}
        initialChunkId={focus.chunkId}
        youtubeEnabled={youtubeEnabled}
        renderMedia={renderMedia}
      />
    </OriginalCard>
  ) : null;

  const chat = <ChatPanel projectId={folder?.id ?? source.project_id} selectedSourceIds={[source.id]} suggestedQuestions={folder?.suggestedQuestions} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6 desk:p-4">
      {live}
      {breadcrumb}
      <div
        data-testid="report-grid"
        data-layout={pinnedLayout ? "pinned" : "default"}
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-(--grid-workspace-tablet) md:gap-4",
          pinnedLayout ? "desk:grid-cols-(--grid-workspace-desk)" : "desk:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_var(--size-chat)]",
        )}
      >
        {pinnedLayout ? (
          original
        ) : (
          <aside aria-label="목차 열" data-testid="toc-column" className="hidden min-h-0 min-w-0 overflow-y-auto pr-1 desk:block">
            <ReportToc title={source.title} items={toc} activeId={activeId} onSelect={selectToc} />
          </aside>
        )}
        <div ref={reportRef} className="min-h-0 min-w-0 overflow-y-auto">
          {report}
        </div>
        <aside aria-label="채팅" data-testid="chat-column" className={`hidden md:block ${PANEL}`}>
          {chat}
        </aside>
      </div>

      {pinnedLayout ? null : original}

      <Sheet open={chatOpen && mode === "mobile"} onOpenChange={setChatOpen}>
        <SheetTrigger asChild>
          <Button className="w-full md:hidden">
            <MessageSquare aria-hidden />
            질문하기
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-(--size-sheet-max-h) overflow-y-auto">
          <SheetHeader className="pb-0">
            <SheetTitle className="sr-only">채팅</SheetTitle>
            <SheetDescription className="sr-only">이 자료에 대해 질문합니다.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{chat}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
