// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "@/lib/sources/handlers";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { CAPTURE_LIMIT_PER_VIDEO, CAPTURE_MAX_BYTES, sniffCaptureImage, type CaptureRow } from "@/lib/storage/captures";
import { CAPTURE_MESSAGES, createCapturesHandlers, timedSourceUrl, type CapturesBackend } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const MOMENT_ID = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const CAPTURE_ID = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const PATH = `org/proj/${SOURCE_ID}/${CAPTURE_ID}.webp`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const source = (over: Partial<SourceRow> = {}): SourceRow => ({
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
  ...over,
});

const row = (id: string, path: string, t: number | string = "12.5"): CaptureRow => ({
  id,
  moment_id: MOMENT_ID,
  t_seconds: t,
  storage_path: path,
  created_at: "2026-11-16T00:00:00Z",
});

function backend(over: Partial<CapturesBackend> = {}): CapturesBackend {
  return {
    getUserId: async () => "u1",
    getSource: async () => source(),
    listCaptures: async () => [],
    signUrls: async (paths) => paths.map((p) => `https://storage.example/sign/${p}`),
    createCapture: vi.fn(async () => ({ ok: true as const, captureId: CAPTURE_ID, storagePath: PATH })),
    upload: vi.fn(async () => true),
    discardCapture: vi.fn(async () => {}),
    ...over,
  };
}

const handlers = (b: CapturesBackend, enabled = true) => createCapturesHandlers({ backend: b, captureEnabled: () => enabled });

function postRequest(bytes: Uint8Array | null, momentId = MOMENT_ID) {
  const form = new FormData();
  form.set("moment_id", momentId);
  if (bytes) form.set("image", new Blob([new Uint8Array(bytes)]), "capture");
  return new Request(`http://localhost/api/sources/${SOURCE_ID}/captures`, { method: "POST", body: form });
}

describe("A-11 법무 게이트", () => {
  it("캡처 플래그가 꺼지면 GET·POST 모두 422 지원 예정, 저장 없음", async () => {
    const b = backend();
    const list = await handlers(b, false).list(new Request("http://localhost/"), SOURCE_ID);
    expect(list.status).toBe(422);
    expect((await list.json()).error.message).toBe(CAPTURE_MESSAGES.notSupported);
    const created = await handlers(b, false).create(postRequest(WEBP), SOURCE_ID);
    expect(created.status).toBe(422);
    expect(b.createCapture).not.toHaveBeenCalled();
    expect(b.upload).not.toHaveBeenCalled();
  });

  it("로그인 안 하면 401", async () => {
    const res = await handlers(backend({ getUserId: async () => null })).create(postRequest(WEBP), SOURCE_ID);
    expect(res.status).toBe(401);
  });
});

describe("POST /captures", () => {
  it("WebP를 저장한다: 행 생성 → 그 경로로 업로드 → 201", async () => {
    const b = backend();
    const res = await handlers(b).create(postRequest(WEBP), SOURCE_ID);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ capture_id: CAPTURE_ID });
    expect(b.createCapture).toHaveBeenCalledWith({ sourceId: SOURCE_ID, momentId: MOMENT_ID, mime: "image/webp", size: WEBP.byteLength });
    expect(b.upload).toHaveBeenCalledWith(PATH, expect.any(Uint8Array), "image/webp");
  });

  it("21장째는 429로 거절하고 업로드하지 않는다", async () => {
    const b = backend({ createCapture: vi.fn(async () => ({ ok: false as const, kind: "limit" as const })) });
    const res = await handlers(b).create(postRequest(PNG), SOURCE_ID);
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toContain(String(CAPTURE_LIMIT_PER_VIDEO));
    expect(b.upload).not.toHaveBeenCalled();
  });

  it("이미지가 아니면 415, 2MB 초과는 413, 둘 다 행을 만들지 않는다", async () => {
    const b = backend();
    expect((await handlers(b).create(postRequest(JPEG), SOURCE_ID)).status).toBe(415);
    const big = new Uint8Array(CAPTURE_MAX_BYTES + 1);
    big.set(PNG);
    expect((await handlers(b).create(postRequest(big), SOURCE_ID)).status).toBe(413);
    expect(b.createCapture).not.toHaveBeenCalled();
  });

  it("유튜브 외 자료 422, 타인·없는·비활성 자료 404, 이미지 누락 400", async () => {
    expect((await handlers(backend({ getSource: async () => source({ source_type: "pdf" }) })).create(postRequest(PNG), SOURCE_ID)).status).toBe(422);
    expect((await handlers(backend({ getSource: async () => null })).create(postRequest(PNG), SOURCE_ID)).status).toBe(404);
    expect((await handlers(backend({ getSource: async () => source({ unavailable_at: "2026-11-10T00:00:00Z" }) })).create(postRequest(PNG), SOURCE_ID)).status).toBe(404);
    expect((await handlers(backend()).create(postRequest(null), SOURCE_ID)).status).toBe(400);
    expect((await handlers(backend()).create(postRequest(PNG, "x"), SOURCE_ID)).status).toBe(400);
  });

  it("RPC가 남의 자료로 거부하면 404, 잠긴 기능은 403", async () => {
    const notFound = backend({ createCapture: async () => ({ ok: false, kind: "not_found" }) });
    expect((await handlers(notFound).create(postRequest(PNG), SOURCE_ID)).status).toBe(404);
    const locked = backend({ createCapture: async () => ({ ok: false, kind: "locked" }) });
    expect((await handlers(locked).create(postRequest(PNG), SOURCE_ID)).status).toBe(403);
  });

  it("업로드가 실패하면 만든 행을 지우고 500", async () => {
    const b = backend({ upload: vi.fn(async () => false) });
    const res = await handlers(b).create(postRequest(PNG), SOURCE_ID);
    expect(res.status).toBe(500);
    expect(b.discardCapture).toHaveBeenCalledWith(CAPTURE_ID);
  });

  it("다른 Origin의 POST는 400", async () => {
    const h = createCapturesHandlers({ backend: backend(), captureEnabled: () => true, siteUrl: "https://app.example" });
    const req = postRequest(PNG);
    const forged = new Request(req, { headers: { origin: "https://evil.example" } });
    expect((await h.create(forged, SOURCE_ID)).status).toBe(400);
  });
});

describe("GET /captures", () => {
  it("서명 URL·시각·채널·그 시각 원본 링크를 준다. 서명 못 한 행은 뺀다", async () => {
    const b = backend({
      listCaptures: async () => [row("c1", "p/1.webp"), row("c2", "p/2.png", 30)],
      signUrls: async () => ["https://storage.example/sign/1", null],
    });
    const res = await handlers(b).list(new Request("http://localhost/"), SOURCE_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      enabled: true,
      limit: 20,
      captures: [
        {
          id: "c1",
          moment_id: MOMENT_ID,
          t_seconds: 12.5,
          url: "https://storage.example/sign/1",
          created_at: "2026-11-16T00:00:00Z",
          channel_title: "채널",
          source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s",
        },
      ],
    });
  });

  it("타인·없는 자료 404", async () => {
    const res = await handlers(backend({ getSource: async () => null })).list(new Request("http://localhost/"), SOURCE_ID);
    expect(res.status).toBe(404);
  });
});

describe("캡처 보조 함수", () => {
  it("매직 바이트로 PNG·WebP만 인정한다", () => {
    expect(sniffCaptureImage(PNG)).toBe("image/png");
    expect(sniffCaptureImage(WEBP)).toBe("image/webp");
    expect(sniffCaptureImage(JPEG)).toBeNull();
    expect(sniffCaptureImage(new Uint8Array(3))).toBeNull();
  });

  it("원본 링크는 11자 video_id일 때만, 시각은 정수 초", () => {
    expect(timedSourceUrl("dQw4w9WgXcQ", 0)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(timedSourceUrl("dQw4w9WgXcQ", 61.9)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=61s");
    expect(timedSourceUrl("bad", 10)).toBeNull();
  });
});

describe("영상 삭제 시 캡처 제거(웹 경로)", () => {
  function fakeClient(rpcError: { code: string } | null) {
    const calls: string[] = [];
    const remove = vi.fn(async (paths: string[]) => {
      calls.push(`remove:${paths.join(",")}`);
      return { data: [], error: null };
    });
    const client = {
      from: (table: string) => ({
        select: () => ({
          in: async () => {
            calls.push(`select:${table}`);
            return { data: [{ storage_path: "o/p/s/1.webp" }, { storage_path: "o/p/s/2.png" }], error: null };
          },
        }),
      }),
      rpc: async (name: string) => {
        calls.push(`rpc:${name}`);
        return rpcError ? { data: null, error: rpcError } : { data: 1, error: null };
      },
      storage: { from: () => ({ remove }) },
    };
    return { client, calls, remove };
  }

  it("경로를 먼저 모으고, 삭제 RPC가 성공한 뒤 객체를 지운다", async () => {
    const { client, calls } = fakeClient(null);
    const result = await createSupabaseSourceReadBackend(client as never).deleteSources("p", [SOURCE_ID]);
    expect(result).toEqual({ ok: true, deleted: 1 });
    expect(calls).toEqual(["select:source_captures", "rpc:delete_sources", "remove:o/p/s/1.webp,o/p/s/2.png"]);
  });

  it("삭제 RPC가 실패하면 객체를 지우지 않는다", async () => {
    const { client, remove } = fakeClient({ code: "P0002" });
    const result = await createSupabaseSourceReadBackend(client as never).deleteSources("p", [SOURCE_ID]);
    expect(result).toEqual({ ok: false, kind: "not_found" });
    expect(remove).not.toHaveBeenCalled();
  });
});
