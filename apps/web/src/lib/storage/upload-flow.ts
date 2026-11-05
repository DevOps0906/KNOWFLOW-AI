import { hasPdfExtension, MAX_FILE_BYTES, MAX_FILES_PER_REQUEST } from "./files";

// 브라우저 쪽 업로드 흐름: 서명 URL 발급 → Storage 직접 업로드 → 등록. 파일 본문은 웹 서버로 보내지 않는다.
export type FileStatus = "waiting" | "uploading" | "registering" | "done" | "error";

export interface FileState {
  name: string;
  status: FileStatus;
  message?: string;
}

export interface UploadDeps {
  fetch: typeof fetch;
  upload(path: string, token: string, file: File): Promise<{ error?: string }>;
  hash(file: File): Promise<string>;
  newKey(): string;
}

interface ApiError {
  error?: { message?: string };
}

const NETWORK_ERROR = "네트워크 연결을 확인하고 다시 시도해 주세요.";

/** 선택 직후의 빠른 검사(서버가 같은 규칙으로 다시 검사한다). 문제가 없으면 null. */
export function clientFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (!hasPdfExtension(file.name) || file.type !== "application/pdf") return "PDF 파일만 올릴 수 있습니다.";
  if (file.size < 1) return "빈 파일입니다.";
  if (file.size > MAX_FILE_BYTES) return "파일은 1개당 50MB까지 올릴 수 있습니다.";
  return null;
}

export async function uploadPdfs(
  projectId: string,
  files: File[],
  deps: UploadDeps,
  onChange: (states: FileState[]) => void,
): Promise<{ accepted: number }> {
  const states: FileState[] = files.map((f) => ({ name: f.name, status: "waiting" }));
  const set = (i: number, patch: Partial<FileState>) => {
    states[i] = { ...states[i]!, ...patch };
    onChange([...states]);
  };
  const failAll = (message: string) => {
    states.forEach((_, i) => (states[i] = { ...states[i]!, status: "error", message }));
    onChange([...states]);
    return { accepted: 0 };
  };

  if (files.length === 0) return { accepted: 0 };
  if (files.length > MAX_FILES_PER_REQUEST) return failAll("한 번에 최대 10개까지 올릴 수 있습니다.");
  const problem = files.map((f) => clientFileProblem(f));
  if (problem.some(Boolean)) {
    problem.forEach((p, i) => set(i, p ? { status: "error", message: p } : { status: "waiting" }));
    return { accepted: 0 };
  }
  onChange([...states]);

  const endpoint = `/api/projects/${projectId}/sources`;
  const post = async (body: unknown) => {
    try {
      const response = await deps.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { response, data: (await response.json().catch(() => ({}))) as ApiError & Record<string, unknown> };
    } catch {
      return null;
    }
  };

  const signed = await post({
    step: "upload_url",
    files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
  });
  if (!signed) return failAll(NETWORK_ERROR);
  if (!signed.response.ok) return failAll(signed.data.error?.message ?? "업로드를 시작하지 못했습니다.");
  const uploads = signed.data.uploads as Array<{ path: string; title: string; token: string }> | undefined;
  if (!uploads || uploads.length !== files.length) return failAll("업로드를 시작하지 못했습니다.");

  const items: Array<{ index: number; path: string; title: string; contentHash: string; idempotencyKey: string }> = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const target = uploads[i]!;
    set(i, { status: "uploading" });
    try {
      const contentHash = await deps.hash(file);
      const uploaded = await deps.upload(target.path, target.token, file);
      if (uploaded.error) {
        set(i, { status: "error", message: "파일을 올리지 못했습니다. 다시 시도해 주세요." });
        continue;
      }
      items.push({ index: i, path: target.path, title: target.title, contentHash, idempotencyKey: deps.newKey() });
      set(i, { status: "registering" });
    } catch {
      set(i, { status: "error", message: "파일을 올리지 못했습니다. 다시 시도해 주세요." });
    }
  }
  if (items.length === 0) return { accepted: 0 };

  const registered = await post({
    step: "register",
    items: items.map(({ path, title, contentHash, idempotencyKey }) => ({ path, title, contentHash, idempotencyKey })),
  });
  if (!registered) {
    items.forEach((it) => set(it.index, { status: "error", message: NETWORK_ERROR }));
    return { accepted: 0 };
  }
  const results = registered.data.results as Array<{ path: string; ok: boolean; error?: { message?: string }; message?: string }> | undefined;
  let accepted = 0;
  for (const item of items) {
    const result = results?.find((r) => r.path === item.path);
    if (result?.ok) {
      accepted++;
      set(item.index, { status: "done" });
    } else {
      set(item.index, {
        status: "error",
        message: result?.message ?? result?.error?.message ?? registered.data.error?.message ?? "등록하지 못했습니다.",
      });
    }
  }
  return { accepted };
}
