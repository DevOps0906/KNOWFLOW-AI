// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "@/lib/sources/handlers";
import { MAX_CAPTURE_BYTES } from "@/lib/storage/images";
import { createCapturesHandlers, type CaptureRow, type CapturesBackend, type CaptureStore, type ReserveResult } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const MOMENT_ID = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const CAPTURE_ID = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const USER = "11111111-1111-4111-8111-111111111111";
const PATH = `${USER}/${SOURCE_ID}/${CAPTURE_ID}.webp`;
const BASE = `https://app.example.test/api/sources/${SOURCE_ID}/captures`;

const source: SourceRow = {
  id: SOURCE_ID,
  project_id: "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22",
  source_type: "youtube",
  title: "강연",
  status: "completed",
  error_code: null,
  unavailable_at: null,
  original_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  video_id: "dQw4w9WgXcQ",
  channel_title: "채널",
  duration_seconds: 600,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

/** VP8X WebP 헤더(가로·세로 지정) */
function webp(width: number, height: number, pad = 0) {
  const b = new Uint8Array(30 + pad);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  b.set([..."VP8X"].map((c) => c.charCodeAt(0)), 12);
  b[16] = 10;
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

/** APP0 + SOF0 JPEG 헤더 */
function jpeg(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function fakeBackend(over: Partial<CapturesBackend> = {}): CapturesBackend {
  return {
    getUserId: vi.fn(async () => USER),
    getSource: vi.fn(async () => source),
    listCaptures: vi.fn(async (): Promise<CaptureRow[]> => [
      { id: CAPTURE_ID, moment_id: MOMENT_ID, t_seconds: "75.500", storage_path: PATH, created_at: "2026-11-17T00:00:00Z" },
    ]),
    captureVisible: vi.fn(async () => true),
    ...over,
  };
}

function fakeStore(over: Partial<CaptureStore> = {}): CaptureStore {
  return {
    reserve: vi.fn(async (): Promise<ReserveResult> => ({ ok: true, captureId: CAPTURE_ID, storagePath: PATH, status: "pending", duplicate: false })),
    upload: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    discard: vi.fn(async () => true),
    removeObject: vi.fn(async () => {}),
    signUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://storage.test/sign/${p}?token=t`]))),
    purge: vi.fn(async () => {}),
    ...over,
  };
}

function setup(opts: { enabled?: boolean; backend?: Partial<CapturesBackend>; store?: Partial<CaptureStore> | null } = {}) {
  const backend = fakeBackend(opts.backend);
  const store = opts.store === null ? null : fakeStore(opts.store);
  const handlers = createCapturesHandlers({
    enabled: () => opts.enabled ?? true,
    backend,
    store: () => store,
    siteUrl: "https://app.example.test",
  });
  return { handlers, backend, store };
}

const post = (body: BodyInit | null, query = `?t=75.5&moment_id=${MOMENT_ID}`, headers: Record<string, string> = { "Idempotency-Key": "key-1" }) =>
  new Request(`${BASE}${query}`, { method: "POST", body, headers: { "content-type": "image/webp", ...headers } });

describe("A-11 스위치·인증·입력", () => {
  it("CAPTURE_ENABLED가 꺼지면 GET·POST·DELETE 모두 422이고 DB·Storage를 건드리지 않는다", async () => {
    const { handlers, backend, store } = setup({ enabled: false });
    for (const res of [
      await handlers.list(new Request(BASE), SOURCE_ID),
      await handlers.create(post(webp(100, 100)), SOURCE_ID),
      await handlers.remove(new Request(`${BASE}/${CAPTURE_ID}`, { method: "DELETE" }), SOURCE_ID, CAPTURE_ID),
    ]) {
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("capture_disabled");
    }
    expect(backend.getUserId).not.toHaveBeenCalled();
    expect(store!.reserve).not.toHaveBeenCalled();
  });

  it("로그인 없으면 401, 잘못된 id·타인 자료는 404, 유튜브 외 자료는 422", async () => {
    expect((await setup({ backend: { getUserId: async () => null } }).handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(401);
    expect((await setup().handlers.create(post(webp(10, 10)), "nope")).status).toBe(404);
    expect((await setup({ backend: { getSource: async () => null } }).handlers.list(new Request(BASE), SOURCE_ID)).status).toBe(404);
    const pdf = setup({ backend: { getSource: async () => ({ ...source, source_type: "pdf" }) } });
    expect((await pdf.handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(422);
    expect((await pdf.handlers.list(new Request(BASE), SOURCE_ID)).status).toBe(422);
  });

  it("시각·장면 id·멱등 키 형식이 틀리면 400, 다른 출처 요청도 400", async () => {
    const { handlers, store } = setup();
    expect((await handlers.create(post(webp(10, 10), "?moment_id=x&t=1"), SOURCE_ID)).status).toBe(400);
    expect((await handlers.create(post(webp(10, 10), "?t=-1"), SOURCE_ID)).status).toBe(400);
    expect((await handlers.create(post(webp(10, 10), "?t=1", {}), SOURCE_ID)).status).toBe(400);
    expect((await handlers.create(post(webp(10, 10), "?t=1", { "Idempotency-Key": "has space" }), SOURCE_ID)).status).toBe(400);
    expect((await handlers.create(post(webp(10, 10), "?t=1", { "Idempotency-Key": "k", origin: "https://evil.test" }), SOURCE_ID)).status).toBe(400);
    expect(store!.reserve).not.toHaveBeenCalled();
  });
});

describe("A-11 POST 이미지 검사", () => {
  it("2MB를 넘으면 413(선언 길이·실제 스트림 모두), 저장하지 않는다", async () => {
    const { handlers, store } = setup();
    const big = webp(100, 100, MAX_CAPTURE_BYTES);
    expect((await handlers.create(post(big), SOURCE_ID)).status).toBe(413);
    // Content-Length 없이 흘려보내는 스트림
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(webp(100, 100));
        c.enqueue(new Uint8Array(MAX_CAPTURE_BYTES));
        c.close();
      },
    });
    const req = new Request(`${BASE}?t=1`, { method: "POST", body: stream, headers: { "Idempotency-Key": "k" }, duplex: "half" } as RequestInit);
    expect((await handlers.create(req, SOURCE_ID)).status).toBe(413);
    expect(store!.reserve).not.toHaveBeenCalled();
    expect(store!.upload).not.toHaveBeenCalled();
  });

  it("WebP·JPEG가 아니거나 가로·세로가 2560을 넘으면 415(Content-Type을 믿지 않는다)", async () => {
    const { handlers, store } = setup();
    // 잘린 SOF: 선언 길이 255인데 실제로는 12바이트 / SOF 선언 길이가 최소(8)보다 짧음
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03]);
    const shortSof = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x06, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0xff, 0xd9]);
    for (const body of [PNG, webp(2561, 100), jpeg(100, 2561), new Uint8Array([1, 2, 3]), truncated, shortSof]) {
      expect((await handlers.create(post(body), SOURCE_ID)).status).toBe(415);
    }
    expect(store!.reserve).not.toHaveBeenCalled();
  });

  it("검사를 통과하면 자리 잡기 → 업로드 → 확정 순서로 저장하고 201", async () => {
    const { handlers, store } = setup();
    const res = await handlers.create(post(jpeg(1280, 720)), SOURCE_ID);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: CAPTURE_ID, duplicate: false });
    expect(store!.reserve).toHaveBeenCalledWith({ sourceId: SOURCE_ID, userId: USER, tSeconds: 75.5, momentId: MOMENT_ID, idempotencyKey: "key-1", mime: "image/jpeg" });
    expect(store!.upload).toHaveBeenCalledWith(PATH, expect.any(Uint8Array), "image/jpeg");
    expect(store!.confirm).toHaveBeenCalledWith(CAPTURE_ID, USER, jpeg(1280, 720).length);
  });
});

describe("A-11 POST 한도·멱등·실패", () => {
  it("21장째(reserve가 limit)는 429이고 업로드하지 않는다", async () => {
    const { handlers, store } = setup({ store: { reserve: async () => ({ ok: false, kind: "limit" }) } });
    const res = await handlers.create(post(webp(10, 10)), SOURCE_ID);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("capture_limit");
    expect(store!.upload).not.toHaveBeenCalled();
  });

  it("같은 멱등 키로 이미 저장된 요청은 다시 올리지 않고 같은 id(200)", async () => {
    const { handlers, store } = setup({
      store: { reserve: async () => ({ ok: true, captureId: CAPTURE_ID, storagePath: PATH, status: "ready", duplicate: true }) },
    });
    const res = await handlers.create(post(webp(10, 10)), SOURCE_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: CAPTURE_ID, duplicate: true });
    expect(store!.upload).not.toHaveBeenCalled();
  });

  it("같은 멱등 키가 다른 요청에서 처리 중(pending)이면 409이고 업로드·삭제를 하지 않는다", async () => {
    const { handlers, store } = setup({
      store: { reserve: async () => ({ ok: true, captureId: CAPTURE_ID, storagePath: PATH, status: "pending", duplicate: true }) },
    });
    const res = await handlers.create(post(webp(10, 10)), SOURCE_ID);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("in_progress");
    expect(store!.upload).not.toHaveBeenCalled();
    expect(store!.discard).not.toHaveBeenCalled();
    expect(store!.confirm).not.toHaveBeenCalled();
  });

  it("확정(confirm)이 예외를 던지면 pending 행을 지우고(upload_failed) 객체를 대기열로 처리한 뒤 500", async () => {
    const { handlers, store } = setup({
      store: {
        confirm: async () => {
          throw new Error("confirm_failed");
        },
      },
    });
    expect((await handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(500);
    expect(store!.discard).toHaveBeenCalledWith(CAPTURE_ID, USER, "upload_failed");
    expect(store!.purge).toHaveBeenCalled();
  });

  it("보상 discard가 false(이미 ready이거나 없음)면 객체를 지우지 않는다", async () => {
    const { handlers, store } = setup({
      store: {
        upload: async () => false,
        discard: vi.fn(async () => false),
      },
    });
    expect((await handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(500);
    expect(store!.purge).not.toHaveBeenCalled();
    expect(store!.removeObject).not.toHaveBeenCalled();
  });

  it("reserve 오류 매핑: not_found 404 · not_youtube 422 · conflict 409", async () => {
    for (const [kind, status] of [["not_found", 404], ["not_youtube", 422], ["conflict", 409]] as const) {
      const { handlers } = setup({ store: { reserve: async () => ({ ok: false, kind }) } });
      expect((await handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(status);
    }
  });

  it("업로드 실패면 행을 지우고(upload_failed) 대기열을 처리한다", async () => {
    const { handlers, store } = setup({ store: { upload: async () => false } });
    expect((await handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(500);
    expect(store!.discard).toHaveBeenCalledWith(CAPTURE_ID, USER, "upload_failed");
    expect(store!.purge).toHaveBeenCalled();
    expect(store!.confirm).not.toHaveBeenCalled();
  });

  it("확정 전에 자료가 삭제되면(confirm false) 올린 객체를 지우고 404", async () => {
    const { handlers, store } = setup({ store: { confirm: async () => false } });
    expect((await handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(404);
    expect(store!.removeObject).toHaveBeenCalledWith(PATH);
  });

  it("service_role 설정이 없으면 503", async () => {
    expect((await setup({ store: null }).handlers.create(post(webp(10, 10)), SOURCE_ID)).status).toBe(503);
  });
});

describe("A-11 GET·DELETE", () => {
  it("목록: 서명 URL·시각·그 시각 원본 링크·채널명", async () => {
    const { handlers } = setup();
    const res = await handlers.list(new Request(BASE), SOURCE_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      unavailable: false,
      limit: 20,
      channel_title: "채널",
      items: [
        {
          id: CAPTURE_ID,
          moment_id: MOMENT_ID,
          t_seconds: 75.5,
          url: `https://storage.test/sign/${PATH}?token=t`,
          source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s",
          created_at: "2026-11-17T00:00:00Z",
        },
      ],
    });
  });

  it("채널명이 파기됐으면 null, 비활성 자료는 서명하지 않고 unavailable", async () => {
    const noChannel = setup({ backend: { getSource: async () => ({ ...source, channel_title: null }) } });
    expect(((await (await noChannel.handlers.list(new Request(BASE), SOURCE_ID)).json()) as { channel_title: unknown }).channel_title).toBeNull();

    const gone = setup({ backend: { getSource: async () => ({ ...source, unavailable_at: "2026-11-17T00:00:00Z" }) } });
    const res = await gone.handlers.list(new Request(BASE), SOURCE_ID);
    expect(await res.json()).toMatchObject({ unavailable: true, items: [] });
    expect(gone.store!.signUrls).not.toHaveBeenCalled();
    expect(gone.backend.listCaptures).not.toHaveBeenCalled();
  });

  it("DELETE: 본인 캡처는 대기열로 옮기고 purge 후 204. 보이지 않는 캡처(타인)는 404", async () => {
    const ok = setup();
    const res = await ok.handlers.remove(new Request(`${BASE}/${CAPTURE_ID}`, { method: "DELETE" }), SOURCE_ID, CAPTURE_ID);
    expect(res.status).toBe(204);
    expect(ok.store!.discard).toHaveBeenCalledWith(CAPTURE_ID, USER, "user_deleted");
    expect(ok.store!.purge).toHaveBeenCalled();

    const other = setup({ backend: { captureVisible: async () => false } });
    expect((await other.handlers.remove(new Request(`${BASE}/${CAPTURE_ID}`, { method: "DELETE" }), SOURCE_ID, CAPTURE_ID)).status).toBe(404);
    expect(other.store!.discard).not.toHaveBeenCalled();
  });
});
