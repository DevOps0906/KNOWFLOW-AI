"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AddSourceForm } from "@/components/sources/add-source-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { FolderOption } from "@/lib/projects/folders";
import { INBOX_FOLDER_NAME } from "@/lib/projects/types";

/**
 * "+ 가져오기": PDF·유튜브·URL 탭 다이얼로그(S-09 폼 재사용) + 폴더 선택(선택 사항).
 * 폴더를 고르지 않으면 기본 폴더 "받은 자료"에 넣고, 성공하면 자료 결과 화면(여러 PDF면 폴더 라이브러리)으로 간다.
 * variant="sidebar"는 사이드바 행(태블릿은 아이콘만), "pill"은 본문 머리의 주 버튼.
 */
export function ImportDialog({
  folders = [],
  defaultFolderId,
  youtubeEnabled = false,
  variant = "pill",
}: {
  folders?: FolderOption[];
  defaultFolderId?: string;
  youtubeEnabled?: boolean;
  variant?: "sidebar" | "pill";
}) {
  // 기본 폴더와 같은 이름의 폴더는 "폴더 선택 안 함"과 같은 뜻이라 목록에서 뺀다
  const choices = folders.filter((f) => f.name !== INBOX_FOLDER_NAME);
  const initial = choices.some((f) => f.id === defaultFolderId) ? defaultFolderId! : "";
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState(initial);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFolderId(initial);
      }}
    >
      <DialogTrigger asChild>
        {variant === "sidebar" ? (
          <button
            type="button"
            aria-label="가져오기"
            title="가져오기"
            className="flex min-h-(--size-touch) w-full items-center gap-3 rounded-row px-3 font-semibold text-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:max-desk:justify-center md:max-desk:px-0"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Plus aria-hidden className="size-4" />
            </span>
            <span className="md:max-desk:hidden">가져오기</span>
          </button>
        ) : (
          <Button>
            <Plus aria-hidden />
            가져오기
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>가져오기</DialogTitle>
          <DialogDescription className="break-keep">
            {youtubeEnabled ? "PDF나 유튜브 영상을" : "PDF를"} 가져오면 매체 이름으로 등록하고 분석을 시작합니다.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-body font-semibold">
          폴더 (선택)
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className="h-10 rounded-control border border-input bg-background px-3 text-body font-normal"
          >
            <option value="">{INBOX_FOLDER_NAME} (기본)</option>
            {choices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <AddSourceForm
          key={folderId}
          projectId={folderId || undefined}
          openResult
          youtubeEnabled={youtubeEnabled}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
