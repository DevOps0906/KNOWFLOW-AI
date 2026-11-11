"use client";

import { useEffect, useRef } from "react";

// 상태 폴링: active일 때만 돈다. 5초에서 시작해 실패·무변화면 두 배씩 30초까지 늘리고,
// resetKey(상태 서명)가 바뀌면 5초로 되돌린다. 탭이 숨겨지면 멈추고, 다시 보이면 바로 한 번 읽는다.

export const POLL_MIN_MS = 5_000;
export const POLL_MAX_MS = 30_000;

export const nextPollDelay = (delay: number) => Math.min(delay * 2, POLL_MAX_MS);

export function usePolling(active: boolean, tick: () => Promise<unknown>, resetKey: string) {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!active) return;
    let delay = POLL_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let running = false;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (stopped || document.hidden) return;
      timer = setTimeout(run, delay);
    };
    async function run() {
      timer = undefined;
      if (running) return;
      running = true;
      try {
        await tickRef.current();
      } catch {
        // 실패도 무변화처럼 간격을 늘린다
      }
      running = false;
      // 상태가 바뀌었다면 resetKey가 바뀌어 이 루프는 정리되고 5초로 새로 시작한다
      delay = nextPollDelay(delay);
      schedule();
    }
    const onVisibility = () => {
      if (document.hidden) clear();
      else void run();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, resetKey]);
}
