"use client";

import { useEffect, useMemo } from "react";
import { Camera, ExternalLink, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/components/workspace/viewer/format";
import { cleanText } from "../embed";
import type { CapturePreview, CapturesState } from "./use-captures";

// 캡처 진입·미리보기·목록(task-030). 진입은 데스크톱(1200 이상)만: 기능 감지와 별개로 CSS로도 숨긴다.
// 출처 표기(결정 6): 시각·원본 링크는 항상, 채널명은 메타데이터가 있을 때만.

/** 장면 카드 옆 캡처 버튼 */
export function CaptureButton({
  title,
  disabled,
  full,
  onCapture,
}: {
  title: string;
  disabled: boolean;
  full: boolean;
  onCapture: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-slot="capture-button"
      className="hidden self-start desk:inline-flex"
      disabled={disabled || full}
      onClick={onCapture}
      aria-label={`${cleanText(title)} 장면 화면 캡처`}
    >
      <Camera aria-hidden className="size-3.5" />
      {full ? "캡처 한도 도달" : "화면 캡처"}
    </Button>
  );
}

/** 업로드 전 미리보기. 확인해야만 저장한다 */
export function CapturePreviewDialog({
  preview,
  busy,
  message,
  onSave,
  onCancel,
}: {
  preview: CapturePreview | null;
  busy: boolean;
  message: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const url = useMemo(() => (preview && typeof URL.createObjectURL === "function" ? URL.createObjectURL(preview.blob) : null), [preview]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (!open && !busy ? onCancel() : undefined)}>
      <DialogContent className="desk:max-w-3xl">
        <DialogHeader>
          <DialogTitle>캡처 미리보기</DialogTitle>
          <DialogDescription>
            {preview
              ? `${formatTimestamp(preview.moment.locator.t_start)} 장면이 맞는지 확인하세요. 이 시각으로 저장되며 이 비공개 자료에만 보관됩니다.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {/* 로컬 blob 미리보기: next/image 최적화 대상이 아니다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="저장 전 캡처 미리보기" className="max-h-[60vh] w-full rounded-row border border-border object-contain" /> : null}
        {message ? (
          <p role="alert" className="text-caption text-destructive">
            {message}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy ? "저장 중" : "맞습니다, 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 저장된 캡처 목록 */
export function CaptureList({
  state,
  busy,
  message,
  onRetry,
  onRemove,
}: {
  state: CapturesState;
  busy: boolean;
  /** 미리보기가 닫힌 상태의 안내(승인 거부 등) */
  message: string | null;
  onRetry: () => void;
  onRemove: (captureId: string) => void;
}) {
  if (state.kind === "off") return null;
  return (
    <section aria-labelledby="capture-list-title" data-slot="capture-list" className="hidden min-w-0 flex-col gap-3 desk:flex">
      <h2 id="capture-list-title" className="text-h2 font-bold">
        장면 캡처{state.kind === "ok" ? ` (${state.data.items.length}/${state.data.limit})` : null}
      </h2>
      {message ? (
        <p role="status" className="rounded-row bg-muted p-3 text-caption text-muted-foreground">
          {message}
        </p>
      ) : null}
      {state.kind === "loading" ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">캡처를 불러오는 중</span>
          <Skeleton aria-hidden className="h-24 w-full rounded-panel" />
        </div>
      ) : state.kind === "error" ? (
        <ErrorState title="캡처를 불러오지 못했습니다" onRetry={onRetry} />
      ) : state.data.items.length === 0 ? (
        <p role="status" className="rounded-row bg-muted p-3 text-caption text-muted-foreground">
          저장한 캡처가 없습니다. 장면 카드의 화면 캡처 버튼을 누르고 이 탭 공유를 승인하면 캡처할 수 있습니다.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {state.data.items.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-card p-3">
              {/* 비공개 버킷 서명 URL(짧은 유효 시간): 서버 프록시·next/image 최적화를 거치지 않는다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.url} alt={`${formatTimestamp(c.t_seconds)} 장면 캡처`} className="aspect-video w-full rounded-row bg-muted object-contain" />
              <p className="text-caption text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{formatTimestamp(c.t_seconds)}</span>
                {state.data.channel_title ? <> · {cleanText(state.data.channel_title)}</> : null}
              </p>
              <div className="flex items-center justify-between gap-2">
                {c.source_url ? (
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-caption text-primary underline underline-offset-4"
                  >
                    원본 영상
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => onRemove(c.id)}
                  aria-label={`${formatTimestamp(c.t_seconds)} 캡처 삭제`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
