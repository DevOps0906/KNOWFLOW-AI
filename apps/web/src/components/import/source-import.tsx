"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUp, BookOpenText, Check, CircleAlert, FileText, Globe, LoaderCircle, Play, Upload } from "lucide-react";
import { usePdfImport, useYoutubeImport } from "@/components/sources/use-source-import";
import { Button } from "@/components/ui/button";
import type { FolderOption } from "@/lib/projects/folders";
import { INBOX_FOLDER_NAME } from "@/lib/projects/types";
import type { FileState, UploadDeps } from "@/lib/storage/upload-flow";
import { cn } from "@/lib/utils";
import { importHref, type ImportTab } from "./import-href";

const STATUS_TEXT: Record<FileState["status"], string> = {
  waiting: "대기",
  uploading: "업로드 중",
  registering: "등록 중",
  done: "등록됨(분석 대기)",
  error: "오류",
};

const TAB =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-control px-3 py-2 text-body font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const CARD = "flex min-h-(--size-import-card) flex-col rounded-row border border-border bg-card px-3.5 pt-3.5 pb-2.5";

/**
 * 가져오기 화면(DESIGN.md §2-2): 아이콘 → 제목 → 세그먼트 탭 줄(링크) → 입력 카드 → 회색 안내.
 * 탭은 경로로 나뉜다(/new/source 유튜브 · /new/source/pdf 문서). 웹사이트는 준비 중.
 * 등록·기본 폴더·이동 로직은 S-09 폼과 같은 훅을 쓴다. 성공하면 자료 결과 화면(여러 PDF면 폴더 라이브러리)으로 간다.
 */
export function SourceImport({
  tab,
  youtubeEnabled,
  folder,
  deps,
}: {
  tab: ImportTab;
  youtubeEnabled: boolean;
  /** ?folder=로 고른 폴더. 없으면 기본 폴더 "받은 자료"에 넣는다. */
  folder?: FolderOption;
  /** 테스트에서 대체한다. */
  deps?: UploadDeps;
}) {
  const tabs: Array<{ id: ImportTab | "web"; label: string; Icon: typeof Play; enabled: boolean }> = [
    { id: "youtube", label: "유튜브", Icon: Play, enabled: youtubeEnabled },
    { id: "pdf", label: "문서", Icon: FileText, enabled: true },
    { id: "web", label: "웹사이트", Icon: Globe, enabled: false },
  ];

  return (
    <div className="mx-auto flex w-full max-w-import min-w-0 flex-col items-center gap-6 px-4 py-10 md:px-6 md:py-16 desk:py-24">
      <span aria-hidden className="grid size-12 place-items-center rounded-panel bg-primary text-primary-foreground">
        <BookOpenText className="size-6" />
      </span>
      <h1 className="text-center text-hero font-semibold break-keep text-heading">무엇을 읽고 정리할까요?</h1>

      <nav aria-label="가져올 자료 종류" className="max-w-full overflow-x-auto">
        <ul className="flex items-center gap-1 rounded-control bg-secondary p-1">
          {tabs.map(({ id, label, Icon, enabled }) => (
            <li key={id}>
              {enabled && id !== "web" ? (
                <Link
                  href={importHref(youtubeEnabled, folder?.id, id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={cn(TAB, tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              ) : (
                <span aria-disabled="true" title={`${label} (준비 중)`} className={cn(TAB, "cursor-not-allowed text-faint")}>
                  <Icon aria-hidden className="size-4" />
                  {label}
                  <span className="text-label">준비 중</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div className="w-full">
        {tab === "youtube" ? <YoutubeCard folderId={folder?.id} deps={deps} /> : <PdfCard folderId={folder?.id} deps={deps} />}
      </div>

      <p className="text-center text-label break-keep text-muted-foreground">
        가져온 자료는 ‘{folder?.name ?? INBOX_FOLDER_NAME}’ 폴더에 들어가고, 분석이 끝나면 요약 리포트가 만들어집니다.
      </p>
    </div>
  );
}

function YoutubeCard({ folderId, deps }: { folderId?: string; deps?: UploadDeps }) {
  const video = useYoutubeImport({ projectId: folderId, navigate: true, deps });
  const state = video.state;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void video.submit();
      }}
      className="flex flex-col gap-3"
    >
      <div className={cn(CARD, "focus-within:border-input")}>
        <input
          type="url"
          inputMode="url"
          aria-label="유튜브 영상 주소"
          aria-describedby="youtube-help"
          placeholder="https://www.youtube.com/watch?v=..."
          value={video.url}
          onChange={(e) => video.setUrl(e.target.value)}
          disabled={video.pending}
          className="w-full min-w-0 bg-transparent text-body outline-none placeholder:text-faint"
        />
        <div className="mt-auto flex items-center justify-end pt-3">
          <Button type="submit" size="icon" aria-label="가져오기" aria-busy={video.pending} disabled={video.pending || video.url.trim().length === 0}>
            {video.pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <ArrowUp aria-hidden />}
          </Button>
        </div>
      </div>
      <p id="youtube-help" className="text-label break-keep text-muted-foreground">
        공개 영상 1건만 등록할 수 있습니다. 재생목록·채널, 비공개·미등록, 라이브, 연령·지역 제한, 어린이용 영상은 지원하지 않습니다.
      </p>
      {state ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cn("flex items-start gap-2 text-caption", state.status === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          <span aria-hidden className="mt-0.5">
            {state.status === "done" ? <Check className="size-4" /> : state.status === "error" ? <CircleAlert className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
          </span>
          <span className="min-w-0 flex-1 break-keep">
            {state.status === "checking" ? "영상 확인 중" : state.status === "done" ? "등록됨(분석 대기)" : state.message}
          </span>
        </p>
      ) : null}
    </form>
  );
}

function PdfCard({ folderId, deps }: { folderId?: string; deps?: UploadDeps }) {
  const input = useRef<HTMLInputElement>(null);
  const clearInput = () => {
    if (input.current) input.current.value = "";
  };
  const pdf = usePdfImport({ projectId: folderId, navigate: true, deps, clearInput });
  const [dragging, setDragging] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void pdf.submit();
      }}
      className="flex flex-col gap-3"
    >
      <div className={CARD}>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!pdf.pending) pdf.pick(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-row border border-dashed border-border px-3 py-4 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
            dragging ? "bg-accent" : "hover:bg-background",
          )}
        >
          <Upload aria-hidden className="size-5 text-muted-foreground" />
          <span className="text-body font-medium break-keep">파일을 끌어다 놓거나 클릭해서 선택</span>
          <span className="text-label break-keep text-muted-foreground">PDF · 파일 1개당 50MB · 한 번에 10개까지</span>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            aria-label="PDF 파일 선택"
            onChange={(e) => pdf.pick(Array.from(e.target.files ?? []))}
            disabled={pdf.pending}
            className="sr-only"
          />
        </label>
        <div className="flex items-center justify-between gap-3 pt-2.5">
          <span className="text-label text-muted-foreground tabular-nums">{pdf.files.length > 0 ? `${pdf.files.length}개 선택됨` : ""}</span>
          <Button type="submit" size="sm" aria-busy={pdf.pending} disabled={!pdf.canSubmit}>
            {pdf.pending ? "올리는 중..." : "가져오기"}
          </Button>
        </div>
      </div>
      <p className="text-label break-keep text-muted-foreground">글자를 선택할 수 없는 스캔 PDF는 지원하지 않을 수 있습니다.</p>

      {pdf.states.length > 0 ? (
        <ul aria-label="선택한 파일" className="flex flex-col gap-2">
          {pdf.states.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex min-w-0 items-start gap-2 text-caption">
              <span aria-hidden className="mt-0.5">
                {s.status === "done" ? <Check className="size-4" /> : s.status === "error" ? <CircleAlert className="size-4 text-destructive" /> : s.status === "waiting" ? null : <LoaderCircle className="size-4 animate-spin" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className={s.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {STATUS_TEXT[s.status]}
                  {s.message ? ` · ${s.message}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {pdf.partial ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-caption break-keep text-destructive">
          <span>일부 파일만 등록되었습니다. 실패한 파일은 다시 가져올 수 있습니다.</span>
          <Link href={pdf.partial} className="font-semibold underline">
            폴더 열기
          </Link>
        </p>
      ) : null}

      {pdf.notice ? (
        <p role="alert" className="text-caption text-destructive">
          {pdf.notice}
        </p>
      ) : null}
    </form>
  );
}
