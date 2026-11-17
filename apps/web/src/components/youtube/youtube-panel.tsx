"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff } from "lucide-react";
import { StateCard } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptureButton, CaptureList, CapturePreviewDialog } from "./capture/capture-ui";
import { useCaptures } from "./capture/use-captures";
import type { MomentsResponse } from "./embed";
import { MomentCards } from "./moment-cards";
import { VideoSummary } from "./video-summary";
import { YoutubePlayer, type Seek } from "./youtube-player";

// S-10 유튜브 영역: 임베드 플레이어 + 영상 요약 + 장면 카드(A-07 /moments).
// 장면 카드·요약 시각을 누르면 iframe src를 바꿔 그 시각부터 재생한다.
// 캡처(task-030 L1): 데스크톱·기능 감지 통과 시 GET /captures로 서버 스위치를 확인하고, 켜져 있을 때만 카드별 캡처 버튼·목록을 보인다.
// 캡처 버튼은 플레이어를 그 카드 t_start로 옮긴 뒤 탭 공유를 요청한다(임베드에서 현재 재생 시각은 읽지 않는다).

export type MomentsState = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: MomentsResponse };

export const YOUTUBE_DISABLED_TEXT = "유튜브 기능 준비 중";

export function YoutubeDisabledNotice() {
  return (
    <p role="status" className="rounded-row bg-muted p-3 text-caption text-muted-foreground">
      {YOUTUBE_DISABLED_TEXT}입니다. 영상 플레이어·요약·장면 카드는 기능이 열리면 보입니다.
    </p>
  );
}

export async function fetchMoments(sourceId: string): Promise<MomentsState> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/moments`, { cache: "no-store" });
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as MomentsResponse };
  } catch {
    return { kind: "error" };
  }
}

export function YoutubePanel({
  sourceId,
  videoId,
  title,
  originalUrl,
  startSeconds,
  autoplay = false,
}: {
  sourceId: string;
  videoId: string | null;
  title: string;
  originalUrl: string | null;
  startSeconds: number | null;
  /** 처음부터 startSeconds에서 재생한다(자료 결과 화면의 인용 칩: 플레이어를 새로 열며 그 시각으로 이동) */
  autoplay?: boolean;
}) {
  const [state, setState] = useState<MomentsState>({ kind: "loading" });
  // 처음에는 인용 위치에서 멈춘 채로 열고(autoplay면 바로 재생), 사용자가 시각을 누르면 그때 자동 재생한다
  const [seek, setSeek] = useState<Seek>({ seconds: startSeconds, autoplay, nonce: 0 });
  const playerRef = useRef<HTMLDivElement>(null);
  const captures = useCaptures(sourceId, true);
  const capturesFull = captures.state.kind === "ok" && captures.state.data.items.length >= captures.state.data.limit;

  const load = useCallback(() => {
    setState({ kind: "loading" });
    void fetchMoments(sourceId).then(setState);
  }, [sourceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchMoments(sourceId).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const play = useCallback((seconds: number) => {
    setSeek((prev) => ({ seconds, autoplay: true, nonce: prev.nonce + 1 }));
  }, []);

  const data = state.kind === "ok" ? state.data : null;
  if (data && !data.enabled) return <YoutubeDisabledNotice />;
  if (data?.enabled && data.unavailable) {
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

  return (
    <section aria-label="영상 플레이어와 장면 카드" data-slot="youtube-viewer" className="flex min-w-0 flex-col gap-4">
      <div ref={playerRef} data-slot="capture-target">
        <YoutubePlayer videoId={videoId} title={title} seek={seek} originalUrl={originalUrl} />
      </div>
      {state.kind === "loading" ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">요약과 장면 카드를 불러오는 중</span>
          <Skeleton aria-hidden className="h-24 w-full rounded-panel" />
          <Skeleton aria-hidden className="h-24 w-full rounded-panel" />
        </div>
      ) : state.kind === "error" ? (
        <ErrorState title="요약과 장면 카드를 불러오지 못했습니다" onRetry={load} />
      ) : data?.enabled ? (
        <>
          {data.summary ? <VideoSummary sentences={data.summary.sentences} onPlay={play} /> : null}
          <MomentCards
            items={data.items}
            onPlay={play}
            renderAction={
              captures.state.kind === "ok"
                ? (m) => (
                    <CaptureButton
                      title={m.title}
                      disabled={captures.busy}
                      full={capturesFull}
                      onCapture={() => {
                        // 먼저 플레이어를 그 카드 시각으로 옮기고(src 교체·자동 재생) 같은 클릭 안에서 탭 공유를 요청한다.
                        // 저장 시각은 카드 t_start이며, 사용자가 미리보기에서 그 장면이 맞는지 확인해야 저장된다
                        play(m.locator.t_start);
                        void captures.capture(m, playerRef.current);
                      }}
                    />
                  )
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
        </>
      ) : null}
    </section>
  );
}
