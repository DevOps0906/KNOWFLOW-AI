"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserUploadDeps } from "@/lib/storage/browser";
import { MAX_FILES_PER_REQUEST } from "@/lib/storage/files";
import { clientFileProblem, uploadPdfs, type FileState, type UploadDeps } from "@/lib/storage/upload-flow";

type Tab = "pdf" | "url";

const STATUS_TEXT: Record<FileState["status"], string> = {
  waiting: "대기",
  uploading: "업로드 중",
  registering: "등록 중",
  done: "등록됨(분석 대기)",
  error: "오류",
};

// S-09 자료 추가: PDF 탭(여러 개) + URL 탭(수집 기능은 task-009에서 연결). 등록 성공은 "분석 완료"가 아니라 "대기"다.
export function AddSourceForm({
  projectId,
  onDone,
  deps,
}: {
  projectId: string;
  onDone?: () => void;
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        {(["pdf", "url"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value === "pdf" ? "PDF" : "URL"}
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
        지원 예정: YouTube · 오디오 · Office · HWP 등. 지금은 PDF와 웹 페이지만 다룹니다.
      </p>

      {notice ? (
        <p role="alert" className="text-caption text-destructive">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:justify-end">
        <Button
          type="submit"
          disabled={tab !== "pdf" || pending || files.length === 0 || files.length > MAX_FILES_PER_REQUEST || blocked}
          aria-busy={pending}
        >
          {pending ? "올리는 중..." : "추가"}
        </Button>
      </div>
    </form>
  );
}
