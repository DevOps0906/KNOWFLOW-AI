"use client";

import { useCallback, useRef, useState } from "react";
import { useCaptures } from "@/components/youtube/capture/use-captures";
import type { MomentItem, MomentsResponse } from "@/components/youtube/embed";
import { fetchMoments } from "@/components/youtube/youtube-panel";
import type { Seek } from "@/components/youtube/youtube-player";
import { useSummaryPoll, type FetchResult } from "./use-summary-poll";

/**
 * 원문 카드를 연 뒤 플레이어(capture-target 안의 iframe)가 붙기를 기다리는 최대 시간.
 * 탭 공유 요청은 사용자 클릭의 일시 활성화 안에서 해야 하므로 길게 기다리지 않는다.
 */
export const PLAYER_WAIT_MS = 1_500;

/** 영상 요약이 아직 없으면(완료 직후 저장 전) 다시 읽는다. 스위치 꺼짐·비활성은 기다리지 않는다 */
const momentsPending = (d: MomentsResponse) => d.enabled && !d.unavailable && d.summary === null;

/** fetchMoments는 loading을 돌려주지 않는다(타입만 좁힌다) */
const loadMoments = async (sourceId: string): Promise<FetchResult<MomentsResponse>> => {
  const s = await fetchMoments(sourceId);
  return s.kind === "ok" ? s : { kind: "error" };
};

const playerTarget = (el: HTMLDivElement | null) => (el?.querySelector("iframe") ? el : null);

// 자료 결과 화면의 영상 상태: /moments(요약·장면 카드), 재생 위치(seek), 캡처.
// 플레이어는 원문 카드 안에 있고 요약·장면 카드는 리포트에 있어서 seek를 화면 단에서 함께 쥔다.
// enabled=false(유튜브 아님·플래그 꺼짐·비활성)면 /moments·/captures를 부르지 않는다.
export function useVideoReport(sourceId: string, enabled: boolean, openOriginal: () => void) {
  const { state, reload } = useSummaryPoll(sourceId, () => loadMoments(sourceId), enabled, momentsPending);
  const [seek, setSeek] = useState<Seek>({ seconds: null, autoplay: false, nonce: 0 });
  const captures = useCaptures(sourceId, enabled);

  // 플레이어 준비 신호: capture-target이 붙으면(콜백 ref) 기다리던 캡처를 이어 간다
  const playerElRef = useRef<HTMLDivElement | null>(null);
  const waitersRef = useRef<Array<(el: HTMLDivElement) => void>>([]);
  const playerRef = useCallback((el: HTMLDivElement | null) => {
    playerElRef.current = el;
    if (el) for (const resolve of waitersRef.current.splice(0)) resolve(el);
  }, []);

  /** 이미 붙은 플레이어가 있으면 바로, 아니면 PLAYER_WAIT_MS까지 기다린다(못 붙으면 null) */
  const waitForPlayer = useCallback((): Promise<HTMLDivElement | null> => {
    const ready = playerTarget(playerElRef.current);
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
      let done = false;
      const finish = (el: HTMLDivElement | null) => {
        if (done) return;
        done = true;
        waitersRef.current = waitersRef.current.filter((w) => w !== onMount);
        resolve(playerTarget(el));
      };
      const onMount = (el: HTMLDivElement) => {
        clearTimeout(timer);
        // 붙은 뒤 iframe이 렌더되도록 한 프레임 기다린다
        requestAnimationFrame(() => finish(el));
      };
      const timer = setTimeout(() => finish(playerElRef.current), PLAYER_WAIT_MS);
      waitersRef.current.push(onMount);
    });
  }, []);

  /** 시각을 누르면 원문 카드를 열고 그 시각부터 재생한다 */
  const play = useCallback(
    (seconds: number) => {
      openOriginal();
      setSeek((prev) => ({ seconds, autoplay: true, nonce: prev.nonce + 1 }));
    },
    [openOriginal],
  );

  /** 캡처: 플레이어를 그 카드 시각으로 옮기고, 플레이어가 준비되면 탭 공유를 요청한다(준비되지 않으면 안내) */
  const capture = useCallback(
    async (m: MomentItem) => {
      play(m.locator.t_start);
      await captures.capture(m, await waitForPlayer());
    },
    [play, waitForPlayer, captures],
  );

  return { state, seek, play, reload, captures, capture, playerRef };
}
