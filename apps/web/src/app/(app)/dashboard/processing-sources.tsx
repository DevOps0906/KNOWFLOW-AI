"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { StatusBadge } from "@/components/status-badge";
import { usePolling } from "@/components/workspace/use-polling";
import type { ProcessingSourceItem } from "@/lib/sources/processing";

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", youtube: "유튜브", url: "웹" };

/** S-06 처리 중 자료 목록. 처리 중 자료가 있을 때만 서버 컴포넌트를 다시 읽는다(5→30초, 탭 숨김 시 멈춤). */
export function ProcessingSources({ items }: { items: ProcessingSourceItem[] }) {
  const router = useRouter();
  const refresh = useCallback(async () => router.refresh(), [router]);
  usePolling(items.length > 0, refresh, items.map((s) => `${s.id}:${s.status}`).join("|"));

  if (items.length === 0) {
    return <p className="text-caption text-muted-foreground">처리 중인 자료가 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-panel border border-border bg-card">
      {items.map((source) => (
        <li key={source.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <p className="truncate font-semibold">{source.title}</p>
            <p className="truncate text-caption text-muted-foreground">
              {TYPE_LABEL[source.sourceType] ?? "자료"} ·{" "}
              <Link href={`/projects/${source.projectId}`} className="underline underline-offset-4">
                {source.projectName || "프로젝트"}
              </Link>
            </p>
          </div>
          <StatusBadge status={source.status === "processing" ? "run" : "wait"} />
        </li>
      ))}
    </ul>
  );
}
