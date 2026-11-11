"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpToLine, Clock, EyeOff, FileX, Info } from "lucide-react";
import { EmptyState, StateCard } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { chunkStartSeconds, locatorLabel, type ChunkPageResponse, type SourceMeta, type ViewerChunk } from "./format";
import { YoutubeSlot } from "./youtube-slot";

// S-10 원문: 청크 50개씩 keyset 이어 읽기, ?chunk=<id>면 그 청크 앞뒤 창을 보여 주고 강조·스크롤한다.
// 원문은 신뢰하지 않는 텍스트다: React 텍스트 노드로만 렌더한다(HTML 주입 금지).

export const VIEWER_PAGE_SIZE = 50;

type Phase = "loading" | "ready" | "not_ready" | "unavailable" | "error";

const PROCESSING_STATUSES = new Set(["queued", "processing"]);

function chunksUrl(sourceId: string, opts: { cursor?: string | null; chunkId?: string | null }) {
  const params = new URLSearchParams({ limit: String(VIEWER_PAGE_SIZE) });
  if (opts.cursor) params.set("cursor", opts.cursor);
  else if (opts.chunkId) params.set("chunk_id", opts.chunkId);
  return `/api/sources/${sourceId}/chunks?${params.toString()}`;
}

async function readMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message : null;
  } catch {
    return null;
  }
}

type FirstPageResult = { kind: "ok"; page: ChunkPageResponse } | { kind: "not_ready"; message: string | null } | { kind: "unavailable" } | { kind: "error" };

/** 첫 쪽(around 창 또는 처음부터)을 읽는다 */
async function fetchFirstPage(sourceId: string, chunkId: string | null): Promise<FirstPageResult> {
  try {
    const res = await fetch(chunksUrl(sourceId, { chunkId }), { cache: "no-store" });
    if (res.status === 409) return { kind: "not_ready", message: await readMessage(res) };
    if (!res.ok) return { kind: "error" };
    const page = (await res.json()) as ChunkPageResponse;
    return page.unavailable ? { kind: "unavailable" } : { kind: "ok", page };
  } catch {
    return { kind: "error" };
  }
}

function initialPhase(source: SourceMeta): Phase {
  if (source.unavailable_at) return "unavailable";
  if (source.status !== "completed") return "not_ready";
  return "loading";
}

export function SourceViewer({ source, initialChunkId }: { source: SourceMeta; initialChunkId: string | null }) {
  const [phase, setPhase] = useState<Phase>(() => initialPhase(source));
  const [items, setItems] = useState<ViewerChunk[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasBefore, setHasBefore] = useState(false);
  const [aroundMissing, setAroundMissing] = useState(false);
  const [notReadyMessage, setNotReadyMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(initialChunkId);

  const highlightRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const endRef = useRef<HTMLParagraphElement | null>(null);
  /** 버튼으로 이어 읽다가 마지막 쪽이 되면 사라진 버튼 대신 끝 안내로 초점을 옮긴다 */
  const focusEndRef = useRef(false);

  /** 첫 쪽 결과를 화면 상태에 반영한다 */
  const applyFirst = useCallback((result: FirstPageResult, chunkId: string | null) => {
    if (result.kind === "not_ready") {
      setNotReadyMessage(result.message);
      setPhase("not_ready");
      return;
    }
    if (result.kind !== "ok") {
      setPhase(result.kind);
      return;
    }
    const { page } = result;
    setItems(page.items);
    setNextCursor(page.next_cursor);
    setHasBefore(page.has_before);
    setAroundMissing(chunkId !== null && page.around === "not_found");
    setMoreFailed(false);
    setPhase("ready");
  }, []);

  /** 다음 쪽: 마지막 chunk_index 커서로 이어 읽는다 */
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const res = await fetch(chunksUrl(source.id, { cursor: nextCursor }), { cache: "no-store" });
      if (!res.ok) throw new Error("chunks_failed");
      const page = (await res.json()) as ChunkPageResponse;
      setItems((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.items.filter((c) => !seen.has(c.id))];
      });
      setNextCursor(page.next_cursor);
    } catch {
      setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, source.id]);

  useEffect(() => {
    if (initialPhase(source) !== "loading") return;
    let cancelled = false;
    void fetchFirstPage(source.id, initialChunkId).then((result) => {
      if (!cancelled) applyFirst(result, initialChunkId);
    });
    return () => {
      cancelled = true;
    };
    // 처음 한 번만: 자료·진입 청크가 바뀌면 페이지가 key로 다시 그려진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 인용 위치로 한 번만 스크롤
  useEffect(() => {
    if (phase !== "ready" || scrolledRef.current || !highlightRef.current) return;
    scrolledRef.current = true;
    highlightRef.current.scrollIntoView?.({ block: "center" });
    highlightRef.current.focus({ preventScroll: true });
  }, [phase, items]);

  useEffect(() => {
    if (nextCursor || !focusEndRef.current) return;
    focusEndRef.current = false;
    endRef.current?.focus();
  }, [nextCursor]);

  // 무한 스크롤: 끝 표시가 보이면 다음 쪽(버튼은 대체 수단으로 항상 둔다)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor || moreFailed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, moreFailed]);

  const reload = (chunkId: string | null) => {
    setPhase("loading");
    void fetchFirstPage(source.id, chunkId).then((result) => applyFirst(result, chunkId));
  };

  const restart = () => {
    setHighlightId(null);
    scrolledRef.current = true;
    reload(null);
  };

  const isYoutube = source.source_type === "youtube";
  const highlighted = items.find((c) => c.id === highlightId);
  const workspaceHref = `/projects/${source.project_id}`;
  const backToWorkspace = (
    <Button asChild variant="outline" size="sm">
      <Link href={workspaceHref}>워크스페이스로</Link>
    </Button>
  );

  if (phase === "unavailable") {
    return (
      <StateCard
        role="status"
        tone="warning"
        icon={<EyeOff />}
        title={isYoutube ? "원본 영상을 더 이상 볼 수 없습니다" : "원본을 더 이상 볼 수 없습니다"}
        description={
          isYoutube
            ? "원본 영상을 더 이상 볼 수 없어 전사와 장면 카드를 숨겼습니다. 자료 정보만 보여 드립니다."
            : "원본을 더 이상 볼 수 없어 내용을 숨겼습니다. 자료 정보만 보여 드립니다."
        }
      >
        {backToWorkspace}
      </StateCard>
    );
  }

  if (phase === "not_ready") {
    const failed = source.status === "failed";
    return (
      <StateCard
        role="status"
        tone={failed ? "danger" : "default"}
        icon={failed ? <FileX /> : <Clock />}
        title={failed ? "처리하지 못한 자료입니다" : "아직 처리가 끝나지 않은 자료입니다"}
        description={
          failed
            ? (source.error_message ?? "자료를 처리하지 못했습니다. 워크스페이스에서 다시 시도해 주세요.")
            : (notReadyMessage ??
              (PROCESSING_STATUSES.has(source.status)
                ? "처리가 끝나면 원문을 볼 수 있습니다. 잠시 후 다시 열어 주세요."
                : "처리가 끝난 뒤 다시 열어 주세요."))
        }
      >
        {backToWorkspace}
      </StateCard>
    );
  }

  if (phase === "error") {
    return <ErrorState title="원문을 불러오지 못했습니다" onRetry={() => reload(highlightId)} />;
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4">
        {isYoutube ? <Skeleton aria-hidden className="aspect-video w-full rounded-panel" /> : null}
        <div role="status" aria-busy="true" className="space-y-3 rounded-panel border border-border bg-card p-4">
          <span className="sr-only">원문을 불러오는 중</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} aria-hidden className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const aroundNotice = aroundMissing ? (
    <p role="status" className="flex items-start gap-2 rounded-row bg-warning-soft p-3 text-caption text-warning">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      인용된 위치를 찾지 못해 처음부터 보여 드립니다. 자료가 다시 처리되어 위치가 바뀌었을 수 있습니다.
    </p>
  ) : null;

  if (items.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        {aroundNotice}
        <EmptyState icon={<FileX />} title="표시할 원문이 없습니다" description="이 자료에서 읽을 수 있는 내용을 찾지 못했습니다.">
          {backToWorkspace}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {isYoutube ? <YoutubeSlot source={source} startSeconds={chunkStartSeconds(highlighted)} /> : null}

      {aroundNotice}

      {hasBefore ? (
        <div>
          <Button variant="outline" size="sm" onClick={restart}>
            <ArrowUpToLine />
            처음부터 보기
          </Button>
        </div>
      ) : null}

      <section aria-label={isYoutube ? "전사 구간" : "원문"} className="rounded-panel border border-border bg-card p-4 md:p-6">
        <ol className="mx-auto flex max-w-reading flex-col gap-4">
          {items.map((chunk) => {
            const active = chunk.id === highlightId;
            const label = locatorLabel(source.source_type, chunk.locator);
            return (
              <li key={chunk.id}>
                <article
                  ref={active ? highlightRef : undefined}
                  tabIndex={active ? -1 : undefined}
                  aria-current={active ? "location" : undefined}
                  data-chunk-id={chunk.id}
                  className={cn(
                    "scroll-mt-4 rounded-row p-2 outline-none focus-visible:outline-2 focus-visible:outline-ring",
                    active && "bg-highlight-soft",
                  )}
                >
                  {label || active ? (
                    <p className="mb-1 flex flex-wrap gap-2 text-caption text-muted-foreground tabular-nums">
                      {label ? <span>{label}</span> : null}
                      {active ? <span className="font-semibold text-foreground">인용된 위치</span> : null}
                    </p>
                  ) : null}
                  <p className="font-serif text-reading leading-reading break-words whitespace-pre-wrap">{chunk.content}</p>
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      <p role="status" aria-live="polite" className={cn("text-center text-caption", moreFailed ? "text-danger" : "sr-only")}>
        {loadingMore ? "다음 원문을 불러오는 중입니다." : moreFailed ? "이어서 불러오지 못했습니다." : ""}
      </p>

      {nextCursor ? (
        <div ref={sentinelRef} className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            aria-disabled={loadingMore || undefined}
            onClick={() => {
              focusEndRef.current = true;
              void loadMore();
            }}
          >
            {loadingMore ? "불러오는 중" : moreFailed ? "다시 시도" : "더 보기"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p ref={endRef} tabIndex={-1} className="text-caption text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring">
            원문의 끝입니다.
          </p>
          {backToWorkspace}
        </div>
      )}
    </div>
  );
}
