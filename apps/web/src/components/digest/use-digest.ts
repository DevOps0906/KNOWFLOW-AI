"use client";

import { useSummaryPoll, type FetchResult } from "@/components/report/use-summary-poll";
import type { DigestResponse } from "./types";

/** 401(로그인 끝남)·404(자료 없음·권한 없음)는 다시 읽어도 같으므로 재조회하지 않고 안내를 보인다 */
export type DigestResult = DigestResponse | "unauthorized" | "not_found";

async function fetchDigest(sourceId: string): Promise<FetchResult<DigestResult>> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/digest`, { cache: "no-store" });
    if (res.status === 401) return { kind: "ok", data: "unauthorized" };
    if (res.status === 404) return { kind: "ok", data: "not_found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as DigestResponse };
  } catch {
    return { kind: "error" };
  }
}

/** 수집 직후 생성 중(pending)일 때만 다시 읽는다. none·failed는 기다리지 않는다 */
const digestPending = (d: DigestResult) => typeof d === "object" && !d.unavailable && d.status === "pending";

// 자료 다이제스트(docs/digest-contract.md §3). enabled=false(미완료·비활성)면 부르지 않는다.
// pending이면 요약 재조회 규칙(use-summary-poll)대로 잠시 다시 읽고, 그동안 generating=true.
export function useDigest(sourceId: string, enabled: boolean) {
  return useSummaryPoll(sourceId, () => fetchDigest(sourceId), enabled, digestPending);
}
