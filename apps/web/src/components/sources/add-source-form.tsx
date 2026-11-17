"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileState, UploadDeps } from "@/lib/storage/upload-flow";
import { usePdfImport, useYoutubeImport } from "./use-source-import";

type Tab = "pdf" | "youtube" | "url";

const TAB_LABEL: Record<Tab, string> = { pdf: "PDF", youtube: "유튜브", url: "URL" };

const STATUS_TEXT: Record<FileState["status"], string> = {
  waiting: "대기",
  uploading: "업로드 중",
  registering: "등록 중",
  done: "등록됨(분석 대기)",
  error: "오류",
};

// S-09 자료 추가: PDF 탭(여러 개) + 유튜브 탭(영상 1건, 기능 플래그) + URL 탭(수집 기능은 task-009에서 연결).
// 등록 성공은 "분석 완료"가 아니라 "대기"다.
// 가져오기(Lilys 구조): projectId(폴더)가 없으면 기본 폴더 "받은 자료"에 넣고, 성공하면 자료 결과 화면(여러 PDF면 폴더 라이브러리)으로 간다.
export function AddSourceForm({
  projectId,
  onDone,
  deps,
  youtubeEnabled = false,
  openResult = false,
}: {
  projectId?: string;
  onDone?: () => void;
  /** 서버가 기능 플래그(YOUTUBE_ENABLED)를 읽어 넘긴다. 꺼지면 유튜브 탭을 그리지 않는다. */
  youtubeEnabled?: boolean;
  /** 폴더를 골랐어도 성공 뒤 결과 화면으로 이동한다(가져오기 다이얼로그). projectId가 없으면 항상 이동한다. */
  openResult?: boolean;
  /** 테스트에서 대체한다. */
  deps?: UploadDeps;
}) {
  const [tab, setTab] = useState<Tab>("pdf");
  const navigate = !projectId || openResult;
  const input = useRef<HTMLInputElement>(null);
  const clearInput = () => {
    if (input.current) input.current.value = "";
  };
  const pdf = usePdfImport({ projectId, navigate, deps, onDone, clearInput });
  const video = useYoutubeImport({ projectId, navigate, deps, onDone });
  const { states, notice, partial } = pdf;
  const pending = pdf.pending || video.pending;
  const videoState = video.state;
  const tabs: Tab[] = youtubeEnabled ? ["pdf", "youtube", "url"] : ["pdf", "url"];

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tab === "youtube") return video.submit();
    return pdf.submit();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div role="group" aria-label="자료 종류" className="flex gap-2">
        {tabs.map((value) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {TAB_LABEL[value]}
          </Button>
        ))}
      </div>

      {tab === "pdf" ? (
        <>
          <label className="flex flex-col gap-2 text-body font-semibold">
            PDF 파일 (여러 개 선택 가능)
            <Input key="pdf"
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => pdf.pick(Array.from(e.target.files ?? []))}
              disabled={pending}
              className="h-auto py-2"
            />
            <span className="text-caption font-normal text-muted-foreground break-keep">
              파일 1개당 50MB, 한 번에 10개까지. 글자를 선택할 수 없는 스캔 PDF는 지원하지 않을 수 있습니다.
            </span>
          </label>
          {states.length > 0 ? (
            <ul aria-label="선택한 파일" className="flex flex-col gap-2">
              {states.map((s, i) => (
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
        </>
      ) : tab === "youtube" ? (
        <>
          <label className="flex flex-col gap-2 text-body font-semibold">
            유튜브 영상 주소
            <Input key="youtube"
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={video.url}
              onChange={(e) => video.setUrl(e.target.value)}
              disabled={pending}
              aria-describedby="youtube-help"
            />
            <span id="youtube-help" className="text-caption font-normal text-muted-foreground break-keep">
              공개 영상 1건만 등록할 수 있습니다. 재생목록·채널, 비공개·미등록, 라이브, 연령·지역 제한, 어린이용 영상은 지원하지 않습니다.
            </span>
          </label>
          {videoState ? (
            <p
              role={videoState.status === "error" ? "alert" : "status"}
              className={`flex items-start gap-2 text-caption ${videoState.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              <span aria-hidden className="mt-0.5">
                {videoState.status === "done" ? <Check className="size-4" /> : videoState.status === "error" ? <CircleAlert className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
              </span>
              <span className="min-w-0 flex-1 break-keep">
                {videoState.status === "checking" ? "영상 확인 중" : videoState.status === "done" ? "등록됨(분석 대기)" : videoState.message}
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <label className="flex flex-col gap-2 text-body font-semibold">
          웹 페이지 주소 (URL)
          <Input key="url" type="url" placeholder="https://" disabled aria-describedby="url-soon" />
          <span id="url-soon" className="text-caption font-normal text-muted-foreground break-keep">
            URL 가져오기는 곧 지원됩니다.
          </span>
        </label>
      )}

      <p className="text-caption text-muted-foreground break-keep">
        {youtubeEnabled
          ? "지원 예정: 오디오 · Office · HWP 등. 지금은 PDF · 유튜브 · 웹 페이지를 다룹니다."
          : "지원 예정: YouTube · 오디오 · Office · HWP 등. 지금은 PDF와 웹 페이지만 다룹니다."}
      </p>

      {partial ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-caption text-destructive break-keep">
          <span>일부 파일만 등록되었습니다. 실패한 파일은 다시 가져올 수 있습니다.</span>
          <Link href={partial} className="font-semibold underline">
            폴더 열기
          </Link>
        </p>
      ) : null}

      {notice ? (
        <p role="alert" className="text-caption text-destructive">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:justify-end">
        <Button
          type="submit"
          disabled={
            tab === "youtube"
              ? pending || video.url.trim().length === 0
              : tab !== "pdf" || !pdf.canSubmit
          }
          aria-busy={pending}
        >
          {pending ? (tab === "youtube" ? "확인 중..." : "올리는 중...") : "추가"}
        </Button>
      </div>
    </form>
  );
}
