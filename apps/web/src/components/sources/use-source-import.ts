"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ensureInboxFolder, importDestination } from "@/lib/projects/quick-start";
import { browserUploadDeps } from "@/lib/storage/browser";
import { MAX_FILES_PER_REQUEST } from "@/lib/storage/files";
import { clientFileProblem, uploadPdfs, type FileState, type UploadDeps } from "@/lib/storage/upload-flow";

// 자료 등록 로직(S-09 폼·가져오기 화면 공용). projectId(폴더)가 없으면 기본 폴더 "받은 자료"에 넣는다.
// navigate면 성공 뒤 자료 결과 화면(여러 PDF면 폴더 라이브러리)으로 간다. 등록 성공은 "분석 완료"가 아니라 "대기"다.
type ImportOptions = { projectId?: string; navigate: boolean; deps?: UploadDeps; onDone?: () => void };

export type VideoState = { status: "checking" | "done" | "error"; message?: string };

/** 넣을 폴더 id. 고른 폴더가 없으면 기본 폴더를 찾거나 만든다. 실패하면 오류 문구. */
async function resolveFolder(projectId?: string): Promise<{ id: string } | { error: string }> {
  if (projectId) return { id: projectId };
  const inbox = await ensureInboxFolder();
  return inbox.ok && inbox.id ? { id: inbox.id } : { error: inbox.message ?? "기본 폴더를 준비하지 못했습니다." };
}

export function useYoutubeImport({ projectId, navigate, deps, onDone }: ImportOptions) {
  const router = useRouter();
  const [url, setUrlState] = useState("");
  const [state, setState] = useState<VideoState>();
  const [pending, setPending] = useState(false);
  // 같은 주소를 다시 보내면 같은 멱등 키를 쓴다(네트워크 재시도에서 중복 등록 방지)
  const key = useRef<string | null>(null);

  function setUrl(value: string) {
    setUrlState(value);
    setState(undefined);
    key.current = null;
  }

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed) return setState({ status: "error", message: "유튜브 영상 주소를 넣어 주세요." });
    const d = deps ?? browserUploadDeps();
    key.current ??= d.newKey();
    setPending(true);
    setState({ status: "checking" });
    try {
      const folder = await resolveFolder(projectId);
      if ("error" in folder) return setState({ status: "error", message: folder.error });
      const response = await d.fetch(`/api/projects/${folder.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ source_type: "youtube", url: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as { sourceId?: unknown; error?: { message?: string } };
      if (response.ok) {
        setState({ status: "done" });
        setUrlState("");
        key.current = null;
        if (navigate) {
          router.push(importDestination(typeof data.sourceId === "string" ? [data.sourceId] : [], folder.id));
        } else {
          router.refresh();
        }
        onDone?.();
      } else {
        setState({ status: "error", message: data.error?.message ?? "등록하지 못했습니다." });
      }
    } catch {
      setState({ status: "error", message: "네트워크 연결을 확인하고 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  }

  return { url, setUrl, state, pending, submit };
}

/** clearInput: 모두 등록된 뒤 파일 입력을 비운다(ref는 호출한 쪽이 갖는다). */
export function usePdfImport({ projectId, navigate, deps, onDone, clearInput }: ImportOptions & { clearInput?: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [states, setStates] = useState<FileState[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [partial, setPartial] = useState<string>();

  function pick(picked: File[]) {
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

  async function submit() {
    if (files.length === 0) return setNotice("올릴 PDF 파일을 선택해 주세요.");
    setPending(true);
    setNotice(undefined);
    setPartial(undefined);
    const folder = await resolveFolder(projectId);
    if ("error" in folder) {
      setPending(false);
      return setNotice(folder.error);
    }
    const { accepted, sourceIds } = await uploadPdfs(folder.id, files, deps ?? browserUploadDeps(), setStates);
    setPending(false);
    if (accepted === 0) return;
    if (navigate && accepted === files.length) {
      router.push(importDestination(sourceIds, folder.id));
      onDone?.();
      return;
    }
    router.refresh();
    if (accepted < files.length) {
      if (navigate) setPartial(`/sources?folder=${encodeURIComponent(folder.id)}`);
      return;
    }
    setFiles([]);
    clearInput?.();
    onDone?.();
  }

  const blocked = states.some((s) => s.status === "error" && s.message) && !pending;
  const canSubmit = !pending && files.length > 0 && files.length <= MAX_FILES_PER_REQUEST && !blocked;

  return { files, states, pending, notice, partial, pick, submit, canSubmit };
}
