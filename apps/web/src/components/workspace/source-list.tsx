"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Check, FileText, Globe, Library, RotateCw, SquarePlay, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { StatusBadge, type ProcessingStatus } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "./timestamp-chip";
import type { WorkspaceSource } from "./types";

const NETWORK_ERROR = "네트워크 연결을 확인하고 다시 시도해 주세요.";

const TYPE = {
  pdf: { label: "PDF", Icon: FileText },
  youtube: { label: "유튜브", Icon: SquarePlay },
  url: { label: "웹", Icon: Globe },
} as const;
type FilterKey = "all" | keyof typeof TYPE;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "pdf", label: "PDF" },
  { key: "youtube", label: "유튜브" },
  { key: "url", label: "웹" },
];

function typeOf(sourceType: string) {
  return Object.hasOwn(TYPE, sourceType) ? TYPE[sourceType as keyof typeof TYPE] : { label: "자료", Icon: FileText };
}

function badgeStatus(status: string): ProcessingStatus {
  if (status === "completed") return "ok";
  if (status === "failed") return "fail";
  if (status === "processing") return "run";
  return "wait";
}

async function errorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return data.error?.message ?? fallback;
}

/** S-08 ① 자료 목록: 유형 필터 · 선택 체크(질의 범위·삭제) · 처리 상태 배지 · 비활성 표시 · 재시도 · 선택 삭제 */
export function SourceList({
  projectId,
  sources,
  selected,
  onSelectedChange,
  onChanged,
  addButton,
}: {
  projectId: string;
  sources: WorkspaceSource[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** 재시도·삭제 뒤 목록을 다시 읽는다 */
  onChanged: () => Promise<unknown> | void;
  addButton?: React.ReactNode;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState<string | null>(null);

  const visible = filter === "all" ? sources : sources.filter((s) => s.source_type === filter);
  // 비활성 자료는 선택(질의 범위·삭제)할 수 없다
  const selectableAll = sources.filter((s) => s.unavailable_at === null);
  const selectableVisible = visible.filter((s) => s.unavailable_at === null);
  const selectedCount = selectableAll.filter((s) => selected.has(s.id)).length;
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((s) => selected.has(s.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  function toggleAll() {
    const next = new Set(selected);
    for (const s of selectableVisible) {
      if (allVisibleSelected) next.delete(s.id);
      else next.add(s.id);
    }
    onSelectedChange(next);
  }

  async function retry(source: WorkspaceSource) {
    setError(undefined);
    setRetrying(source.id);
    try {
      const response = await fetch(`/api/sources/${source.id}/retry`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!response.ok) setError(await errorMessage(response, "다시 시도하지 못했습니다."));
      else await onChanged();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setRetrying(null);
    }
  }

  /** A-04 DELETE. 성공하면 지운 id를 선택에서 빼고 목록을 다시 읽는다 */
  async function removeSources(ids: string[]) {
    if (ids.length === 0) return;
    setError(undefined);
    try {
      const response = await fetch(`/api/projects/${projectId}/sources`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: ids }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "자료를 삭제하지 못했습니다."));
      } else {
        onSelectedChange(new Set([...selected].filter((id) => !ids.includes(id))));
        await onChanged();
      }
    } catch {
      setError(NETWORK_ERROR);
    }
  }

  if (sources.length === 0) {
    return (
      <EmptyState icon={<Library />} title="아직 자료가 없습니다" description="PDF나 영상을 추가하면 분석한 뒤 질문할 수 있습니다.">
        {addButton}
      </EmptyState>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="group" aria-label="자료 유형" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant="outline"
            className="aria-pressed:font-semibold"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {filter === f.key ? <Check aria-hidden /> : null}
            {f.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-caption text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={allVisibleSelected}
            onChange={toggleAll}
            disabled={selectableVisible.length === 0}
          />
          전체 선택 ({selectedCount}/{selectableAll.length})
        </label>
        <ConfirmDelete
          description={`자료 ${selectedCount}개가 목록과 질문 범위에서 빠집니다. 처리 중인 자료는 처리가 멈춥니다.`}
          onConfirm={() => removeSources(selectableAll.filter((s) => selected.has(s.id)).map((s) => s.id))}
        >
          <Button type="button" size="sm" variant="outline" disabled={selectedCount === 0}>
            <Trash2 aria-hidden />
            선택 자료 삭제
          </Button>
        </ConfirmDelete>
      </div>

      {error ? (
        <p role="alert" className="text-caption break-keep text-destructive">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-caption text-muted-foreground">이 유형의 자료가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="자료 목록">
          {visible.map((source) => {
            const { label, Icon } = typeOf(source.source_type);
            const inactive = source.unavailable_at !== null;
            const canRetry = source.status === "failed" && source.latest_job?.retryable !== false;
            return (
              <li
                key={source.id}
                data-testid="source-row"
                className={cn("flex min-w-0 items-start gap-3 rounded-row p-2 hover:bg-muted", inactive && "text-muted-foreground")}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  aria-label={`${source.title} 선택`}
                  checked={!inactive && selected.has(source.id)}
                  disabled={inactive}
                  aria-describedby={inactive ? `inactive-${source.id}` : undefined}
                  onChange={() => toggle(source.id)}
                />
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {source.status === "completed" ? (
                    <Link
                      href={`/sources/${source.id}`}
                      className="block truncate font-semibold outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {source.title}
                    </Link>
                  ) : (
                    <p className="truncate font-semibold">{source.title}</p>
                  )}
                  <p className="text-caption text-muted-foreground">
                    {label}
                    {source.source_type === "youtube" && source.duration_seconds !== null ? (
                      <span className="tabular-nums"> · {formatTimestamp(source.duration_seconds)}</span>
                    ) : null}
                    {source.channel_title ? <span> · {source.channel_title}</span> : null}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={badgeStatus(source.status)} />
                    {source.source_type === "youtube" ? <Badge variant="outline">유튜브</Badge> : null}
                    {inactive ? (
                      <Badge variant="secondary">
                        <Ban aria-hidden />
                        비활성
                      </Badge>
                    ) : null}
                  </div>
                  {inactive ? (
                    <p id={`inactive-${source.id}`} className="mt-1 text-caption break-keep">
                      원본을 더 이상 볼 수 없어 선택할 수 없고 질문 범위에서 빠집니다.
                    </p>
                  ) : null}
                  {source.status === "failed" && source.error_message ? (
                    <p className="mt-1 text-caption break-keep text-destructive">{source.error_message}</p>
                  ) : null}
                  {canRetry ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={retrying === source.id}
                      aria-busy={retrying === source.id}
                      aria-label={`${source.title} 다시 시도`}
                      onClick={() => retry(source)}
                    >
                      <RotateCw aria-hidden />
                      재시도
                    </Button>
                  ) : null}
                </div>
                <ConfirmDelete
                  description={`"${source.title}"이(가) 목록과 질문 범위에서 빠집니다. 처리 중인 자료는 처리가 멈춥니다.`}
                  onConfirm={() => removeSources([source.id])}
                >
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`${source.title} 삭제`}>
                    <Trash2 aria-hidden />
                  </Button>
                </ConfirmDelete>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 삭제 확인 창. 여는 버튼(children)으로 포커스가 돌아간다. */
function ConfirmDelete({
  description,
  onConfirm,
  children,
}: {
  description: string;
  onConfirm: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>자료를 삭제할까요?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              취소
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" disabled={pending} aria-busy={pending} onClick={confirm}>
            {pending ? "삭제하는 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
