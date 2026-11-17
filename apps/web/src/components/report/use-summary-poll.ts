"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 요약 재조회: 완료 직후에는 Worker가 요약을 아직 저장하지 않았을 수 있다(후행 단계).
// 요약이 비어 있으면 3초에서 시작해 두 배씩 최대 10초 간격으로, 처음 읽은 때부터 최대 2분 동안 다시 읽는다.
// 그동안 generating=true("요약을 만드는 중"). 시간이 지나면 빈 상태로 두고, reload로 처음부터 다시 기다린다.

export const SUMMARY_POLL = { firstMs: 3_000, maxMs: 10_000, windowMs: 120_000 } as const;

export const nextSummaryDelay = (delay: number) => Math.min(delay * 2, SUMMARY_POLL.maxMs);

export type SummaryPollState<T> = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: T; generating: boolean };

export type FetchResult<T> = { kind: "error" } | { kind: "ok"; data: T };

/**
 * enabled일 때 load를 부르고, pending(data)가 참이면(요약이 아직 없음) 정해진 간격으로 다시 부른다.
 * 오류가 나면 재조회를 멈추고 error로 둔다(reload로 다시 시도). resetKey(자료 id)가 바뀌면 처음부터 다시 읽는다.
 */
export function useSummaryPoll<T>(resetKey: string, load: () => Promise<FetchResult<T>>, enabled: boolean, pending: (data: T) => boolean) {
  const [state, setState] = useState<SummaryPollState<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  const pendingRef = useRef(pending);
  useEffect(() => {
    loadRef.current = load;
    pendingRef.current = pending;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = Date.now();
    let delay: number = SUMMARY_POLL.firstMs;
    const run = async () => {
      const result = await loadRef.current();
      if (cancelled) return;
      if (result.kind === "error") {
        setState({ kind: "error" });
        return;
      }
      const wait = pendingRef.current(result.data) && Date.now() - start + delay <= SUMMARY_POLL.windowMs;
      setState({ kind: "ok", data: result.data, generating: wait });
      if (!wait) return;
      timer = setTimeout(() => void run(), delay);
      delay = nextSummaryDelay(delay);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [resetKey, enabled, attempt]);

  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  return { state, reload };
}
