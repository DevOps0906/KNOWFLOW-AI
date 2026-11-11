"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserUploadDeps } from "@/lib/storage/browser";
import { MAX_FILES_PER_REQUEST } from "@/lib/storage/files";
import { clientFileProblem, uploadPdfs, type FileState, type UploadDeps } from "@/lib/storage/upload-flow";

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
export function AddSourceForm({
  projectId,
  onDone,
  deps,
  youtubeEnabled = false,
}: {
  projectId: string;
  onDone?: () => void;
  /** 서버가 기능 플래그(YOUTUBE_ENABLED)를 읽어 넘긴다. 꺼지면 유튜브 탭을 그리지 않는다. */
  youtubeEnabled?: boolean;
  /** 테스트에서 대체한다. */
  deps?: UploadDeps;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pdf");
  const [files, setFiles] = useState<File[]>([]);
  const [states, setStates] = useState<FileState[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoState, setVideoState] = useState<{ status: "checking" | "done" | "error"; message?: string }>();
  // 같은 주소를 다시 보내면 같은 멱등 키를 쓴다(네트워크 재시도에서 중복 등록 방지)
  const videoKey = useRef<string | null>(null);
  const tabs: Tab[] = youtubeEnabled ? ["pdf", "youtube", "url"] : ["pdf", "url"];

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setNotice(undefined);
    setFiles(picked);
    setStates(
      picked.map((f) => {
        const problem = clientFileProblem(f);
        return problem ? { name: f.name, status: "error" as const, message: problem } : { name: f.name, status: "waiting" as const };
      }),
    );
    if (picked.length > MAX_FILES_PER_REQUEST) setNotice("한 번에 최대 10개까지 올릴 수 있습니다.");
  }

  async function submitYoutube() {
    const url = videoUrl.trim();
    if (!url) return setVideoState({ status: "error", message: "유튜브 영상 주소를 넣어 주세요." });
    const d = deps ?? browserUploadDeps();
    videoKey.current ??= d.newKey();
    setPending(true);
    setVideoState({ status: "checking" });
    try {
      const response = await d.fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": videoKey.current },
        body: JSON.stringify({ source_type: "youtube", url }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (response.ok) {
        setVideoState({ status: "done" });
        setVideoUrl("");
        videoKey.current = null;
        router.refresh();
        onDone?.();
      } else {
        setVideoState({ status: "error", message: data.error?.message ?? "등록하지 못했습니다." });
      }
    } catch {
      setVideoState({ status: "error", message: "네트워크 연결을 확인하고 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tab === "youtube") return submitYoutube();
    if (files.length === 0) return setNotice("올릴 PDF 파일을 선택해 주세요.");
    setPending(true);
    setNotice(undefined);
    const { accepted } = await uploadPdfs(projectId, files, deps ?? browserUploadDeps(), setStates);
    setPending(false);
    if (accepted > 0) {
      router.refresh();
      if (accepted === files.length) {
        setFiles([]);
        if (input.current) input.current.value = "";
        onDone?.();
      }
    }
  }

  const blocked = states.some((s) => s.status === "error" && s.message) && !pending;

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
            <Input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={onPick}
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
            <Input
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setVideoState(undefined);
                videoKey.current = null;
              }}
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
          <Input type="url" placeholder="https://" disabled aria-describedby="url-soon" />
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
              ? pending || videoUrl.trim().length === 0
              : tab !== "pdf" || pending || files.length === 0 || files.length > MAX_FILES_PER_REQUEST || blocked
          }
          aria-busy={pending}
        >
          {pending ? (tab === "youtube" ? "확인 중..." : "올리는 중...") : "추가"}
        </Button>
      </div>
    </form>
  );
}
