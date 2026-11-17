import { CAPTURE_DISABLED_CODE, CAPTURE_LIMIT, type CaptureItem, type CapturesResponse } from "@/components/youtube/capture/types";
import type { SourceRow } from "@/lib/sources/handlers";
import { captureDimensionsOk, MAX_CAPTURE_BYTES, readBodyCapped, sniffCaptureImage, type CaptureMime } from "@/lib/storage/images";

// A-11 /api/sources/:id/captures(task-030): 사용자 승인 탭 캡처 L1.
// 스위치(CAPTURE_ENABLED)가 꺼지면 모든 호출 422 "지원 예정"(DB를 읽지 않는다).
// 소유 확인은 세션(RLS)으로 먼저 하고, 쓰기·업로드·서명·삭제는 service_role(store)만 한다. user_id는 세션에서만 꺼낸다.

export interface CaptureRow {
  id: string;
  moment_id: string | null;
  t_seconds: number | string;
  storage_path: string;
  created_at: string;
}

export interface CapturesBackend {
  getUserId(): Promise<string | null>;
  /** RLS로 보이는 자료(본인·미삭제). 없으면 null */
  getSource(sourceId: string): Promise<SourceRow | null>;
  /** RLS로 보이는 그 자료의 ready 캡처(시각 순) */
  listCaptures(sourceId: string): Promise<CaptureRow[]>;
  /** RLS로 보이는 그 자료의 캡처인지 */
  captureVisible(sourceId: string, captureId: string): Promise<boolean>;
}

export type ReserveResult =
  | { ok: true; captureId: string; storagePath: string; status: "pending" | "ready"; duplicate: boolean }
  | { ok: false; kind: "not_found" | "not_youtube" | "limit" | "conflict" | "invalid" | "unknown" };

/** service_role 전용 동작. 서버 설정이 없으면 핸들러가 503 */
export interface CaptureStore {
  reserve(input: {
    sourceId: string;
    userId: string;
    tSeconds: number;
    momentId: string | null;
    idempotencyKey: string;
    mime: CaptureMime;
  }): Promise<ReserveResult>;
  upload(path: string, bytes: Uint8Array, mime: CaptureMime): Promise<boolean>;
  confirm(captureId: string, userId: string, bytes: number): Promise<boolean>;
  discard(captureId: string, userId: string, reason: "user_deleted" | "upload_failed"): Promise<boolean>;
  /** 객체를 지운다. 실패하면 경로를 삭제 대기열에 다시 넣는다 */
  removeObject(path: string): Promise<void>;
  /** 경로 → 서명 URL. 실패한 경로는 빠진다 */
  signUrls(paths: string[]): Promise<Map<string, string>>;
  /** 삭제 대기열 처리(purgeCaptures) */
  purge(): Promise<void>;
}

export interface CapturesDeps {
  enabled: () => boolean;
  backend: CapturesBackend;
  store: () => CaptureStore | null;
  siteUrl?: string | undefined;
}

export const CAPTURE_MESSAGES = {
  disabled: "화면 캡처는 지원 예정입니다.",
  unauthorized: "로그인이 필요합니다.",
  notFound: "자료를 찾을 수 없습니다.",
  captureNotFound: "캡처를 찾을 수 없습니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  tooLarge: "캡처 이미지는 2MB까지 저장할 수 있습니다.",
  unsupported: "WebP 또는 JPEG 이미지(가로·세로 2560 이하)만 저장할 수 있습니다.",
  notYoutube: "유튜브 자료에서만 캡처할 수 있습니다.",
  limit: `캡처는 영상당 ${CAPTURE_LIMIT}장까지 저장할 수 있습니다.`,
  conflict: "같은 요청이 다른 내용으로 이미 처리되었습니다. 다시 시도해 주세요.",
  inProgress: "같은 캡처를 저장하고 있습니다. 잠시 후 목록을 확인해 주세요.",
  unavailable: "캡처 기능을 잠시 쓸 수 없습니다.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
const disabled = () => fail(422, CAPTURE_DISABLED_CODE, CAPTURE_MESSAGES.disabled);
const unauthorized = () => fail(401, "unauthorized", CAPTURE_MESSAGES.unauthorized);
const notFound = () => fail(404, "not_found", CAPTURE_MESSAGES.notFound);
const badRequest = () => fail(400, "bad_request", CAPTURE_MESSAGES.invalidRequest);
const serverError = () => fail(500, "server_error", CAPTURE_MESSAGES.server);
const storeMissing = () => fail(503, "capture_unavailable", CAPTURE_MESSAGES.unavailable);

/** 그 시각의 원본 링크. 형식이 틀린 video_id면 빈 문자열 */
export function captureSourceUrl(videoId: string | null, tSeconds: number) {
  if (!videoId || !VIDEO_ID.test(videoId)) return "";
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(Math.max(0, tSeconds))}s`;
}

function parseSeconds(raw: string | null): number | null {
  if (raw === null || !/^\d{1,5}(\.\d{1,3})?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 86400 ? n : null;
}

function crossOrigin(request: Request, siteUrl: string | undefined) {
  const origin = request.headers.get("origin");
  if (!origin || !siteUrl) return false;
  try {
    return origin !== new URL(siteUrl).origin;
  } catch {
    return true;
  }
}

export function createCapturesHandlers(deps: CapturesDeps) {
  const { backend } = deps;

  /** 공통 앞단: 스위치 → 로그인 → id 형식 → 자료(RLS). 실패면 Response */
  async function guard(sourceId: string): Promise<Response | { userId: string; source: SourceRow }> {
    if (!deps.enabled()) return disabled();
    const userId = await backend.getUserId();
    if (!userId) return unauthorized();
    if (!UUID.test(sourceId)) return notFound();
    const source = await backend.getSource(sourceId);
    if (!source) return notFound();
    return { userId, source };
  }

  return {
    async list(_request: Request, sourceId: string): Promise<Response> {
      try {
        const g = await guard(sourceId);
        if (g instanceof Response) return g;
        const { source } = g;
        const empty: CapturesResponse = { unavailable: false, limit: CAPTURE_LIMIT, channel_title: source.channel_title, items: [] };
        // 서명 전에 자료 상태를 다시 확인한다(비활성이면 서명하지 않는다)
        if (source.unavailable_at) return json(200, { ...empty, unavailable: true, channel_title: null });
        if (source.source_type !== "youtube") return fail(422, "not_youtube_source", CAPTURE_MESSAGES.notYoutube);

        const rows = await backend.listCaptures(sourceId);
        if (rows.length === 0) return json(200, empty);
        const store = deps.store();
        if (!store) return storeMissing();
        const urls = await store.signUrls(rows.map((r) => r.storage_path));
        const items: CaptureItem[] = [];
        for (const r of rows) {
          const url = urls.get(r.storage_path);
          if (!url) continue;
          const t = Number(r.t_seconds);
          items.push({ id: r.id, moment_id: r.moment_id, t_seconds: t, url, source_url: captureSourceUrl(source.video_id, t), created_at: r.created_at });
        }
        return json(200, { ...empty, items } satisfies CapturesResponse);
      } catch {
        return serverError();
      }
    },

    async create(request: Request, sourceId: string): Promise<Response> {
      try {
        const g = await guard(sourceId);
        if (g instanceof Response) return g;
        const { userId, source } = g;
        if (crossOrigin(request, deps.siteUrl)) return badRequest();
        if (source.unavailable_at) return notFound();
        if (source.source_type !== "youtube") return fail(422, "not_youtube_source", CAPTURE_MESSAGES.notYoutube);

        const url = new URL(request.url);
        const tSeconds = parseSeconds(url.searchParams.get("t"));
        const momentRaw = url.searchParams.get("moment_id");
        const key = request.headers.get("idempotency-key");
        if (tSeconds === null || (momentRaw !== null && !UUID.test(momentRaw)) || !key || !KEY.test(key)) return badRequest();

        // 바이트 상한에서 스트림을 끊고(413), 매직 바이트·헤더 크기를 본 뒤에만 저장한다(415)
        const body = await readBodyCapped(request, MAX_CAPTURE_BYTES);
        if (!body.ok) return body.kind === "too_large" ? fail(413, "too_large", CAPTURE_MESSAGES.tooLarge) : fail(415, "unsupported", CAPTURE_MESSAGES.unsupported);
        const info = sniffCaptureImage(body.bytes);
        if (!info || !captureDimensionsOk(info)) return fail(415, "unsupported", CAPTURE_MESSAGES.unsupported);

        const store = deps.store();
        if (!store) return storeMissing();
        const reserved = await store.reserve({ sourceId, userId, tSeconds, momentId: momentRaw, idempotencyKey: key, mime: info.mime });
        if (!reserved.ok) {
          switch (reserved.kind) {
            case "not_found":
              return notFound();
            case "not_youtube":
              return fail(422, "not_youtube_source", CAPTURE_MESSAGES.notYoutube);
            case "limit":
              return fail(429, "capture_limit", CAPTURE_MESSAGES.limit);
            case "conflict":
              return fail(409, "conflict", CAPTURE_MESSAGES.conflict);
            case "invalid":
              return badRequest();
            default:
              return serverError();
          }
        }
        // 같은 멱등 키의 기존 행: 다시 올리지 않는다. 저장이 끝났으면 그 결과, 다른 요청이 처리 중이면 409
        if (reserved.duplicate) {
          if (reserved.status === "ready") return json(200, { id: reserved.captureId, duplicate: true });
          return fail(409, "in_progress", CAPTURE_MESSAGES.inProgress);
        }

        // 실패 보상: pending 행만 지우고(ready면 지우지 않음) 경로를 대기열에 넣은 뒤 객체를 지운다.
        // 보상마저 실패하면 pending 행은 10분 뒤 다음 reserve가 대기열로 옮긴다
        const compensate = async () => {
          if (await store.discard(reserved.captureId, userId, "upload_failed")) await store.purge();
        };
        if (!(await store.upload(reserved.storagePath, body.bytes, info.mime))) {
          await compensate().catch(() => {});
          return serverError();
        }
        let confirmed: boolean;
        try {
          confirmed = await store.confirm(reserved.captureId, userId, body.bytes.length);
        } catch {
          await compensate().catch(() => {});
          return serverError();
        }
        if (!confirmed) {
          // 그새 자료·프로젝트가 삭제·비활성이 됐다(트리거가 행을 지움). 방금 올린 객체를 지운다(실패하면 대기열로)
          await store.removeObject(reserved.storagePath).catch(() => {});
          return notFound();
        }
        return json(201, { id: reserved.captureId, duplicate: false });
      } catch {
        return serverError();
      }
    },

    async remove(request: Request, sourceId: string, captureId: string): Promise<Response> {
      try {
        const g = await guard(sourceId);
        if (g instanceof Response) return g;
        if (crossOrigin(request, deps.siteUrl)) return badRequest();
        if (!UUID.test(captureId) || !(await backend.captureVisible(sourceId, captureId))) {
          return fail(404, "not_found", CAPTURE_MESSAGES.captureNotFound);
        }
        const store = deps.store();
        if (!store) return storeMissing();
        if (!(await store.discard(captureId, g.userId, "user_deleted"))) return fail(404, "not_found", CAPTURE_MESSAGES.captureNotFound);
        // 객체 삭제 실패는 대기열에 남아 다음 처리에서 다시 지운다
        await store.purge().catch(() => {});
        return new Response(null, { status: 204, headers: NO_STORE });
      } catch {
        return serverError();
      }
    },
  };
}
