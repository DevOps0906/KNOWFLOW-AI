import type { SourceRow } from "@/lib/sources/handlers";
import {
  CAPTURE_LIMIT_PER_VIDEO,
  CAPTURE_MAX_BYTES,
  sniffCaptureImage,
  type CaptureMime,
  type CaptureRow,
  type CreateCaptureResult,
} from "@/lib/storage/captures";

// A-11 /api/sources/:id/captures(task-030): L1 사용자 승인 탭 캡처 목록(GET)·저장(POST).
// 법무 게이트: 캡처 플래그가 꺼져 있으면 인증 뒤 모든 호출 422 "지원 예정". 플래그는 task-026 프레임 저장 허용 판정 뒤에만 켠다.
// 소유·삭제·비활성·영상당 20장 판정은 RLS·RPC(create_source_capture)가 하고, 여기서는 입력(형식·크기·매직 바이트)과 응답만 만든다.
// 캡처는 비공개 버킷에만 두고 짧은 서명 URL로만 내보낸다(공개 공유 없음).

/** 서명 URL 유효 시간(초) */
export const CAPTURE_URL_TTL_SECONDS = 300;
/** 멀티파트 본문 상한: 이미지 상한 + 폼 필드 여유 */
const BODY_MAX_BYTES = CAPTURE_MAX_BYTES + 64 * 1024;

export interface CapturesBackend {
  getUserId(): Promise<string | null>;
  /** RLS로 보이는 자료. 없으면 null */
  getSource(sourceId: string): Promise<SourceRow | null>;
  /** RLS로 보이는 그 자료의 캡처(만든 순) */
  listCaptures(sourceId: string): Promise<CaptureRow[]>;
  /** 경로별 서명 URL. 만들지 못한 경로는 null */
  signUrls(paths: string[], ttlSeconds: number): Promise<Array<string | null>>;
  createCapture(input: { sourceId: string; momentId: string; mime: CaptureMime; size: number }): Promise<CreateCaptureResult>;
  upload(path: string, bytes: Uint8Array, mime: CaptureMime): Promise<boolean>;
  discardCapture(captureId: string): Promise<void>;
}

export interface CapturesDeps {
  backend: CapturesBackend;
  /** 캡처 플래그(유튜브 플래그와 별도, 기본 꺼짐) */
  captureEnabled: () => boolean;
  /** Origin 검사 기준(POST). 없으면 검사를 건너뛴다 */
  siteUrl?: string | undefined;
}

export interface CaptureItem {
  id: string;
  moment_id: string | null;
  t_seconds: number;
  url: string;
  created_at: string;
  channel_title: string | null;
  /** 그 시각의 원본 링크(https://www.youtube.com/watch?v=<id>&t=<초>s) */
  source_url: string | null;
}

export type CapturesListResponse = { enabled: false } | { enabled: true; limit: number; captures: CaptureItem[] };

export const CAPTURE_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  sourceNotFound: "자료를 찾을 수 없습니다.",
  notSupported: "화면 캡처는 지원 예정입니다.",
  notYoutube: "유튜브 자료에서만 캡처할 수 있습니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  tooLarge: "캡처 이미지는 2MB 이하만 저장할 수 있습니다.",
  unsupported: "PNG 또는 WebP 이미지만 저장할 수 있습니다.",
  limit: `영상 하나에 캡처는 ${CAPTURE_LIMIT_PER_VIDEO}장까지 저장할 수 있습니다.`,
  locked: "현재 플랜에서는 이 기능을 쓸 수 없습니다.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

/** 그 시각의 원본 링크. video_id가 형식에 맞지 않으면 null */
export function timedSourceUrl(videoId: string | null, seconds: number): string | null {
  if (!videoId || !VIDEO_ID.test(videoId)) return null;
  const t = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `https://www.youtube.com/watch?v=${videoId}${t > 0 ? `&t=${t}s` : ""}`;
}

export function createCapturesHandlers(deps: CapturesDeps) {
  const { backend } = deps;

  /** 공통 앞단: 401 → 404(형식) → 422(플래그) */
  async function gate(sourceId: string): Promise<Response | null> {
    if (!(await backend.getUserId())) return fail(401, "unauthorized", CAPTURE_MESSAGES.unauthorized);
    if (!UUID.test(sourceId)) return fail(404, "not_found", CAPTURE_MESSAGES.sourceNotFound);
    if (!deps.captureEnabled()) return fail(422, "capture_not_supported", CAPTURE_MESSAGES.notSupported);
    return null;
  }

  return {
    list: async (_request: Request, sourceId: string): Promise<Response> => {
      try {
        const blocked = await gate(sourceId);
        if (blocked) return blocked;
        const source = await backend.getSource(sourceId);
        if (!source) return fail(404, "not_found", CAPTURE_MESSAGES.sourceNotFound);
        if (source.source_type !== "youtube") return fail(422, "not_youtube", CAPTURE_MESSAGES.notYoutube);
        // 비활성 자료의 캡처는 DB가 이미 지웠다(행이 없으면 빈 목록)
        if (source.unavailable_at) return json(200, { enabled: true, limit: CAPTURE_LIMIT_PER_VIDEO, captures: [] } satisfies CapturesListResponse);

        const rows = await backend.listCaptures(sourceId);
        const urls = rows.length > 0 ? await backend.signUrls(rows.map((r) => r.storage_path), CAPTURE_URL_TTL_SECONDS) : [];
        const captures: CaptureItem[] = [];
        rows.forEach((row, i) => {
          const url = urls[i];
          // 업로드 중이거나 객체가 없는 행은 내보내지 않는다
          if (!url) return;
          const t = Number(row.t_seconds);
          captures.push({
            id: row.id,
            moment_id: row.moment_id,
            t_seconds: t,
            url,
            created_at: row.created_at,
            channel_title: source.channel_title,
            source_url: timedSourceUrl(source.video_id, t),
          });
        });
        return json(200, { enabled: true, limit: CAPTURE_LIMIT_PER_VIDEO, captures } satisfies CapturesListResponse);
      } catch {
        return fail(500, "server_error", CAPTURE_MESSAGES.server);
      }
    },

    /** POST multipart/form-data: moment_id(장면 카드 id) · image(PNG/WebP, 2MB 이하) */
    create: async (request: Request, sourceId: string): Promise<Response> => {
      try {
        const origin = request.headers.get("origin");
        if (origin && deps.siteUrl && origin !== new URL(deps.siteUrl).origin) {
          return fail(400, "invalid_request", CAPTURE_MESSAGES.invalidRequest);
        }
        const blocked = await gate(sourceId);
        if (blocked) return blocked;
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
          return fail(400, "invalid_request", CAPTURE_MESSAGES.invalidRequest);
        }
        const declared = Number(request.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return fail(413, "too_large", CAPTURE_MESSAGES.tooLarge);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return fail(400, "invalid_request", CAPTURE_MESSAGES.invalidRequest);
        }
        const momentId = form.get("moment_id");
        const image = form.get("image");
        if (typeof momentId !== "string" || !UUID.test(momentId) || !(image instanceof Blob)) {
          return fail(400, "invalid_request", CAPTURE_MESSAGES.invalidRequest);
        }
        if (image.size > CAPTURE_MAX_BYTES) return fail(413, "too_large", CAPTURE_MESSAGES.tooLarge);
        const bytes = new Uint8Array(await image.arrayBuffer());
        // 선언된 형식은 믿지 않고 매직 바이트로 판정한다
        const mime = sniffCaptureImage(bytes);
        if (!mime) return fail(415, "unsupported", CAPTURE_MESSAGES.unsupported);

        const source = await backend.getSource(sourceId);
        if (!source || source.unavailable_at) return fail(404, "not_found", CAPTURE_MESSAGES.sourceNotFound);
        if (source.source_type !== "youtube") return fail(422, "not_youtube", CAPTURE_MESSAGES.notYoutube);

        const created = await backend.createCapture({ sourceId, momentId, mime, size: bytes.byteLength });
        if (!created.ok) {
          switch (created.kind) {
            case "unauthorized":
              return fail(401, "unauthorized", CAPTURE_MESSAGES.unauthorized);
            case "not_found":
              return fail(404, "not_found", CAPTURE_MESSAGES.sourceNotFound);
            case "not_youtube":
              return fail(422, "not_youtube", CAPTURE_MESSAGES.notYoutube);
            case "invalid":
              return fail(400, "invalid_request", CAPTURE_MESSAGES.invalidRequest);
            case "limit":
              return fail(429, "capture_limit", CAPTURE_MESSAGES.limit);
            case "locked":
              return fail(403, "feature_locked", CAPTURE_MESSAGES.locked);
            default:
              return fail(500, "server_error", CAPTURE_MESSAGES.server);
          }
        }
        if (!(await backend.upload(created.storagePath, bytes, mime))) {
          await backend.discardCapture(created.captureId).catch(() => {});
          return fail(500, "server_error", CAPTURE_MESSAGES.server);
        }
        return json(201, { capture_id: created.captureId });
      } catch {
        return fail(500, "server_error", CAPTURE_MESSAGES.server);
      }
    },
  };
}
