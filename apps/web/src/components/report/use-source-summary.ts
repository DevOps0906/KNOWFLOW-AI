"use client";

import type { SourceSummaryResponse } from "./types";
import { useSummaryPoll, type FetchResult } from "./use-summary-poll";

async function fetchSourceSummary(sourceId: string): Promise<FetchResult<SourceSummaryResponse>> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/summary`, { cache: "no-store" });
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as SourceSummaryResponse };
  } catch {
    return { kind: "error" };
  }
}

const summaryPending = (d: SourceSummaryResponse) => !d.unavailable && d.summary === null;

// PDF 자료 요약(/summary). enabled=false(PDF 아님·미완료·비활성)면 부르지 않는다. 유튜브 플래그와 무관하다.
// 요약이 아직 없으면(완료 직후 저장 전) 잠시 다시 읽는다(use-summary-poll).
export function useSourceSummary(sourceId: string, enabled: boolean) {
  return useSummaryPoll(sourceId, () => fetchSourceSummary(sourceId), enabled, summaryPending);
}
