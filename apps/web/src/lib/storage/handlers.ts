import { createHash, randomUUID } from "node:crypto";
import {
  hasPdfExtension,
  hasPdfMagic,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  sanitizeFileName,
  titleFromFileName,
} from "./files";

export type RegisterKind =
  | "unauthorized"
  | "not_found"
  | "invalid"
  | "limit"
  | "conflict"
  | "too_large"
  | "unsupported"
  | "unknown";

export interface SourcesBackend {
  getUserId(): Promise<string | null>;
  projectExists(projectId: string): Promise<boolean>;
  createUploadUrl(path: string): Promise<{ ok: true; token: string; signedUrl: string } | { ok: false }>;
  /** Storage 객체의 앞부분과 전체 크기를 읽는다. 없으면 missing. */
  readHead(path: string): Promise<{ ok: true; size: number | null; head: Uint8Array } | { ok: false; kind: "missing" | "error" }>;
  register(input: {
    projectId: string;
    title: string;
    path: string;
    contentHash: string | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ ok: true; sourceId: string; jobId: string | null; duplicate: boolean } | { ok: false; kind: RegisterKind }>;
}

export interface SourceAuditEvent {
  event: "upload_url" | "register";
  outcome: "success" | "failure";
  reason?: string;
  userId?: string;
  projectId?: string;
  count?: number;
}

/** A-04 유튜브 분기 입력. 구현은 서버 전용 `@/server/youtube`(task-027b). */
export interface YoutubeRegisterInput {
  userId: string;
  projectId: string;
  body: Record<string, unknown>;
  /** A-04 공통 규칙: `Idempotency-Key` 헤더 */
  idempotencyKey: string | null;
  projectExists: (projectId: string) => Promise<boolean>;
}

export type YoutubeRegisterOutcome =
  | { ok: true; sourceId: string; jobId: string | null; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string; reason: string };

export interface YoutubeSources {
  register(input: YoutubeRegisterInput): Promise<YoutubeRegisterOutcome>;
}

export interface SourcesDeps {
  backend: SourcesBackend;
  /** 없으면 유튜브 등록은 422(기능 꺼짐). */
  youtube?: YoutubeSources;
  siteUrl?: string | undefined;
  /** 감사 로그. 파일명·본문·URL은 넘기지 않는다. */
  log: (event: SourceAuditEvent) => void;
}

export const SOURCE_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  notFound: "프로젝트를 찾을 수 없습니다.",
  tooLarge: "파일은 1개당 50MB까지 올릴 수 있습니다.",
  unsupported: "PDF 파일만 올릴 수 있습니다.",
  tooMany: "한 번에 최대 10개까지 올릴 수 있습니다.",
  missing: "업로드된 파일을 찾지 못했습니다. 다시 올려 주세요.",
  limit: "자료 수 또는 이번 달 처리 한도에 도달했습니다.",
  duplicate: "이미 같은 내용의 자료가 있거나 같은 요청이 다른 입력으로 들어왔습니다.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

class Stop extends Error {
  constructor(readonly response: Response) {
    super("stop");
  }
}

interface ItemFailure {
  status: number;
  code: string;
  message: string;
}

const KIND_FAILURE: Record<RegisterKind, ItemFailure> = {
  unauthorized: { status: 401, code: "unauthorized", message: SOURCE_MESSAGES.unauthorized },
  not_found: { status: 404, code: "not_found", message: SOURCE_MESSAGES.notFound },
  invalid: { status: 422, code: "invalid_input", message: SOURCE_MESSAGES.missing },
  limit: { status: 429, code: "limit_exceeded", message: SOURCE_MESSAGES.limit },
  conflict: { status: 409, code: "conflict", message: SOURCE_MESSAGES.duplicate },
  too_large: { status: 413, code: "file_too_large", message: SOURCE_MESSAGES.tooLarge },
  unsupported: { status: 415, code: "unsupported_media_type", message: SOURCE_MESSAGES.unsupported },
  unknown: { status: 500, code: "server_error", message: SOURCE_MESSAGES.server },
};

export function createSourceHandlers(deps: SourcesDeps) {
  const { backend, log } = deps;

  async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new Stop(fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest));
    }
    const text = await request.text();
    if (text.length <= 65_536) {
      try {
        const body: unknown = JSON.parse(text);
        if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
      } catch {
        // 아래에서 400
      }
    }
    throw new Stop(fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest));
  }

  async function uploadUrls(userId: string, projectId: string, body: Record<string, unknown>) {
    const files = body.files;
    if (!Array.isArray(files) || files.length === 0) return fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest);
    if (files.length > MAX_FILES_PER_REQUEST) return fail(400, "too_many_files", SOURCE_MESSAGES.tooMany);

    // 전부 검증한 뒤에 URL을 발급한다(일부만 발급되는 상태를 피한다)
    const planned: Array<{ title: string }> = [];
    for (const file of files as Array<Record<string, unknown>>) {
      const name = sanitizeFileName(file?.name);
      const size = file?.size;
      if (!name || typeof size !== "number" || !Number.isFinite(size) || size < 1) {
        return fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest);
      }
      if (!hasPdfExtension(name) || file.type !== "application/pdf") {
        return fail(415, "unsupported_media_type", SOURCE_MESSAGES.unsupported);
      }
      if (size > MAX_FILE_BYTES) return fail(413, "file_too_large", SOURCE_MESSAGES.tooLarge);
      planned.push({ title: titleFromFileName(name) ?? "문서" });
    }

    if (!(await backend.projectExists(projectId))) return fail(404, "not_found", SOURCE_MESSAGES.notFound);

    const uploads = [];
    for (const { title } of planned) {
      // 저장 경로에는 사용자 입력(파일명)을 넣지 않는다: user/project/무작위.pdf
      const path = `${userId}/${projectId}/${randomUUID()}.pdf`;
      const url = await backend.createUploadUrl(path);
      if (!url.ok) {
        log({ event: "upload_url", outcome: "failure", reason: "sign_failed", userId, projectId });
        return fail(500, "server_error", SOURCE_MESSAGES.server);
      }
      uploads.push({ path, title, token: url.token, signedUrl: url.signedUrl });
    }
    log({ event: "upload_url", outcome: "success", userId, projectId, count: uploads.length });
    return json(200, { uploads });
  }

  async function registerOne(userId: string, projectId: string, raw: unknown) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const path = typeof item.path === "string" ? item.path : "";
    const title = titleFromFileName(typeof item.title === "string" ? `${item.title}.pdf` : undefined);
    const contentHash = item.contentHash === undefined || item.contentHash === null ? null : item.contentHash;
    const key = item.idempotencyKey;
    const prefix = `${userId}/${projectId}/`;
    const fileId = path.startsWith(prefix) ? path.slice(prefix.length).replace(/\.pdf$/, "") : "";

    const bad = (failure: ItemFailure) => ({ path, ok: false as const, ...failure });
    if (!UUID.test(fileId) || fileId !== fileId.toLowerCase() || !path.endsWith(".pdf") || !title || typeof key !== "string" || !KEY.test(key)) {
      return bad({ status: 400, code: "bad_request", message: SOURCE_MESSAGES.invalidRequest });
    }
    if (contentHash !== null && (typeof contentHash !== "string" || !HASH.test(contentHash))) {
      return bad({ status: 400, code: "bad_request", message: SOURCE_MESSAGES.invalidRequest });
    }

    // 서버 재검증: 객체 존재·크기·매직 바이트(MIME·크기는 DB가 한 번 더 확인한다)
    const head = await backend.readHead(path);
    if (!head.ok) {
      return head.kind === "missing"
        ? bad({ status: 422, code: "file_missing", message: SOURCE_MESSAGES.missing })
        : bad(KIND_FAILURE.unknown);
    }
    if (head.size !== null && head.size > MAX_FILE_BYTES) return bad(KIND_FAILURE.too_large);
    if (!hasPdfMagic(head.head)) return bad(KIND_FAILURE.unsupported);

    const requestHash = createHash("sha256").update(JSON.stringify([projectId, path, title, contentHash])).digest("hex");
    const result = await backend.register({
      projectId,
      title,
      path,
      contentHash: contentHash as string | null,
      idempotencyKey: key,
      requestHash,
    });
    if (!result.ok) return bad(KIND_FAILURE[result.kind]);
    return { path, ok: true as const, status: 202, sourceId: result.sourceId, jobId: result.jobId, duplicate: result.duplicate };
  }

  async function register(userId: string, projectId: string, body: Record<string, unknown>) {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) return fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest);
    if (items.length > MAX_FILES_PER_REQUEST) return fail(400, "too_many_files", SOURCE_MESSAGES.tooMany);

    const results = [];
    for (const item of items) results.push(await registerOne(userId, projectId, item));
    const accepted = results.filter((r) => r.ok).length;
    log({
      event: "register",
      outcome: accepted > 0 ? "success" : "failure",
      reason: accepted === results.length ? undefined : "partial_or_failed",
      userId,
      projectId,
      count: accepted,
    });
    const firstFailure = results.find((r) => !r.ok) as (ItemFailure & { ok: false }) | undefined;
    if (accepted > 0) return json(202, { results });
    return json(firstFailure!.status, { error: { code: firstFailure!.code, message: firstFailure!.message }, results });
  }

  async function registerYoutube(userId: string, projectId: string, body: Record<string, unknown>, idempotencyKey: string | null) {
    const result = deps.youtube
      ? await deps.youtube.register({ userId, projectId, body, idempotencyKey, projectExists: (id) => backend.projectExists(id) })
      : ({ ok: false, status: 422, code: "youtube_disabled", message: "유튜브 등록은 아직 사용할 수 없습니다.", reason: "youtube_disabled" } as const);
    if (!result.ok) {
      log({ event: "register", outcome: "failure", reason: `youtube:${result.reason}`, userId, projectId });
      return fail(result.status, result.code, result.message);
    }
    log({ event: "register", outcome: "success", reason: result.duplicate ? "youtube:duplicate" : "youtube", userId, projectId, count: 1 });
    return json(202, { sourceId: result.sourceId, jobId: result.jobId, duplicate: result.duplicate, status: "queued" });
  }

  return {
    post: async (request: Request, projectId: string): Promise<Response> => {
      try {
        const origin = request.headers.get("origin");
        if (origin && deps.siteUrl && origin !== new URL(deps.siteUrl).origin) {
          return fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest);
        }
        const userId = await backend.getUserId();
        if (!userId) return fail(401, "unauthorized", SOURCE_MESSAGES.unauthorized);
        if (!UUID.test(projectId)) return fail(404, "not_found", SOURCE_MESSAGES.notFound);
        const body = await readJson(request);
        if (body.source_type === "youtube") return await registerYoutube(userId, projectId, body, request.headers.get("idempotency-key"));
        if (body.step === "upload_url") return await uploadUrls(userId, projectId, body);
        if (body.step === "register") return await register(userId, projectId, body);
        return fail(400, "bad_request", SOURCE_MESSAGES.invalidRequest);
      } catch (e) {
        if (e instanceof Stop) return e.response;
        return fail(500, "server_error", SOURCE_MESSAGES.server);
      }
    },
  };
}
