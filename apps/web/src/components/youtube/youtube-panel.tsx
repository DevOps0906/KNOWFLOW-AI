"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff } from "lucide-react";
import { StateCard } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CaptureGallery, CaptureMomentButton } from "./capture/capture-gallery";
import { useCaptures, useDesktopCapture } from "./capture/use-captures";
import { EmbedPlayer } from "./embed-player";
import { MomentCards, type MomentCardItem } from "./moment-cards";
import { VideoSummary, type VideoSummarySentence } from "./video-summary";

/** GET /api/sources/:id/moments 응답(정본: app/api/sources/[sourceId]/moments/handler.ts) */
export type MomentsPayload =
  | { enabled: false }
  | { enabled: true; unavailable: true }
  | { enabled: true; unavailable: false; moments: MomentCardItem[]; summary: VideoSummarySentence[] | null };

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: MomentsPayload };

async function fetchMoments(sourceId: string): Promise<State> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/moments`, { cache: "no-store" });
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as MomentsPayload };
  } catch {
    return { kind: "error" };
  }
}

export function YoutubeDisabledNotice() {
  return <p className="text-muted-foreground">유튜브 기능 준비 중입니다. 플레이어·영상 요약·장면 카드는 기능이 열리면 보입니다.</p>;
}

// S-10 유튜브 영역: 공식 임베드 플레이어 + 영상 요약 + 장면 카드(L0). 요약·카드의 시각을 누르면 그 시각부터 재생한다.
// captureEnabled(서버 캡처 플래그)이고 데스크톱이면 장면 카드마다 L1 탭 캡처 버튼과 캡처 목록을 보인다(task-030).
export function YoutubePanel({
  sourceId,
  videoId,
  title,
  originalUrl,
  initialStart,
  captureEnabled = false,
}: {
  sourceId: string;
  videoId: string | null;
  title: string;
  originalUrl: string | null;
  initialStart: number | null;
  captureEnabled?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // 처음엔 인용 위치에서 멈춰 있고, 사용자가 시각을 누르면 그 시각부터 자동 재생한다
  const [seek, setSeek] = useState({ start: initialStart, autoplay: false, key: 0 });

  useEffect(() => {
    let cancelled = false;
    void fetchMoments(sourceId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const playerRef = useRef<HTMLDivElement>(null);
  const momentsReady = state.kind === "ok" && state.data.enabled && !state.data.unavailable;
  const canCapture = useDesktopCapture(captureEnabled) && momentsReady;
  const capture = useCaptures(sourceId, canCapture);

  const onSeek = useCallback((seconds: number) => setSeek((prev) => ({ start: seconds, autoplay: true, key: prev.key + 1 })), []);
  const reload = () => {
    setState({ kind: "loading" });
    void fetchMoments(sourceId).then(setState);
  };

  if (state.kind === "ok" && !state.data.enabled) return <YoutubeDisabledNotice />;
  if (state.kind === "ok" && state.data.enabled && state.data.unavailable) {
    return (
      <StateCard role="status" tone="warning" icon={<EyeOff />} title="원본 영상을 더 이상 볼 수 없습니다" description="영상 요약과 장면 카드를 숨겼습니다." />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div ref={playerRef}>
        <EmbedPlayer videoId={videoId} title={title} originalUrl={originalUrl} start={seek.start} autoplay={seek.autoplay} playKey={seek.key} />
      </div>
      {state.kind === "loading" ? (
        <div role="status" aria-busy="true" className="grid gap-4 desk:grid-cols-2">
          <span className="sr-only">영상 요약과 장면 카드를 불러오는 중</span>
          <Skeleton aria-hidden className="h-32 w-full rounded-panel" />
          <Skeleton aria-hidden className="h-32 w-full rounded-panel" />
        </div>
      ) : state.kind === "error" ? (
        <ErrorState title="영상 요약과 장면 카드를 불러오지 못했습니다" onRetry={reload} />
      ) : state.data.enabled && !state.data.unavailable ? (
        <div className="grid min-w-0 gap-4 desk:grid-cols-2">
          <VideoSummary sentences={state.data.summary} onSeek={onSeek} />
          <MomentCards
            moments={state.data.moments}
            onSeek={onSeek}
            renderAction={
              canCapture
                ? (m, label) => (
                    <CaptureMomentButton
                      label={label}
                      busy={capture.status.kind === "busy" && capture.status.momentId === m.id}
                      disabled={capture.status.kind === "busy"}
                      onCapture={() => {
                        // 그 시각으로 이동하고, 같은 클릭 안에서 탭 공유 승인 창을 띄운다(사용자 활성화 필요)
                        onSeek(m.locator.t_start);
                        void capture.captureMoment(m.id, playerRef.current);
                      }}
                    />
                  )
                : undefined
            }
          />
          {canCapture ? (
            <div className="desk:col-span-2">
              <CaptureGallery list={capture.list} status={capture.status} onRetry={capture.reload} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
