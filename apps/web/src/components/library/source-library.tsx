"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { FileText, Folder, Globe, Trash2, SquarePlay } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/components/workspace/use-polling";
import type { LibrarySourceItem } from "@/lib/sources/library";
import { cn } from "@/lib/utils";

export const TYPE_LABEL: Record<string, string> = { pdf: "PDF", youtube: "유튜브", url: "웹" };
const TYPE_ICON: Record<string, typeof FileText> = { pdf: FileText, youtube: SquarePlay, url: Globe };

const dateParts = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" });

/** YYYY.MM.DD(한국 시간) */
export function formatLibraryDate(iso: string): string {
  const parts = Object.fromEntries(dateParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}.${parts.month}.${parts.day}`;
}

const STATUS_BADGE = { queued: "wait", processing: "run", failed: "fail" } as const;

/**
 * 자료 라이브러리 행 목록(구분선 없는 행): 16:9 썸네일 · 제목 / 회색 "유형 · 폴더" · 오른쪽 날짜, 처리 중·실패면 상태 배지.
 * hover(터치 기기는 항상) 체크박스로 여러 개 골라 삭제한다. 처리 중 자료가 있으면 서버 컴포넌트를 다시 읽는다(5→30초).
 */
export function SourceLibrary({ items, showFolder = true }: { items: LibrarySourceItem[]; showFolder?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const processing = items.filter((s) => s.status === "queued" || s.status === "processing");
  const refresh = useCallback(async () => router.refresh(), [router]);
  usePolling(processing.length > 0, refresh, processing.map((s) => `${s.id}:${s.status}`).join("|"));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 자료 삭제 API는 폴더 단위라 폴더별로 나눠 보낸다(A-04 DELETE)
  async function removeSelected() {
    const byFolder = new Map<string, string[]>();
    for (const s of items) if (selected.has(s.id)) byFolder.set(s.folderId, [...(byFolder.get(s.folderId) ?? []), s.id]);
    setPending(true);
    setError(undefined);
    let failed = false;
    for (const [folderId, ids] of byFolder) {
      try {
        const response = await fetch(`/api/projects/${folderId}/sources`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_ids: ids }),
        });
        if (!response.ok) failed = true;
      } catch {
        failed = true;
      }
    }
    setPending(false);
    if (failed) setError("일부 자료를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    setSelected(new Set());
    router.refresh();
  }

  const picking = selected.size > 0;

  return (
    <div className="flex flex-col gap-2">
      {picking ? (
        <div role="region" aria-label="선택한 자료" className="flex flex-wrap items-center gap-2 rounded-row bg-muted px-3 py-2">
          <span className="flex-1 text-caption font-semibold tabular-nums">{selected.size}개 선택</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            선택 해제
          </Button>
          <Button variant="destructive" size="sm" disabled={pending} aria-busy={pending} onClick={() => void removeSelected()}>
            <Trash2 aria-hidden />
            {pending ? "삭제 중..." : "삭제"}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive break-keep">
          {error}
        </p>
      ) : null}
      <ul aria-label="자료 목록" className="flex flex-col gap-1">
        {items.map((source) => {
          const Icon = TYPE_ICON[source.sourceType] ?? FileText;
          const checked = selected.has(source.id);
          const badge = source.status === "completed" ? null : STATUS_BADGE[source.status];
          return (
            <li
              key={source.id}
              className={cn("group flex min-w-0 items-center gap-3 rounded-row p-2 hover:bg-muted", checked && "bg-accent")}
            >
              <input
                type="checkbox"
                aria-label={`${source.title} 선택`}
                checked={checked}
                onChange={() => toggle(source.id)}
                className={cn(
                  "size-4 shrink-0 accent-primary pointer-coarse:opacity-100 focus-visible:opacity-100 group-hover:opacity-100",
                  picking ? "opacity-100" : "opacity-0",
                )}
              />
              <span aria-hidden className="grid aspect-video w-20 shrink-0 place-items-center rounded-row bg-secondary text-muted-foreground md:w-24">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sources/${source.id}`}
                  className="block truncate font-medium outline-none hover:underline focus-visible:underline"
                >
                  {source.title}
                </Link>
                <p className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
                  <span>{TYPE_LABEL[source.sourceType] ?? "자료"}</span>
                  {showFolder ? (
                    <>
                      <span aria-hidden>·</span>
                      <Folder aria-hidden className="size-3 shrink-0" />
                      <span className="truncate">{source.folderName || "폴더"}</span>
                    </>
                  ) : null}
                </p>
              </div>
              {badge ? <StatusBadge status={badge} /> : null}
              <time dateTime={source.createdAt} className="shrink-0 text-caption tabular-nums text-muted-foreground max-md:hidden">
                {formatLibraryDate(source.createdAt)}
              </time>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
