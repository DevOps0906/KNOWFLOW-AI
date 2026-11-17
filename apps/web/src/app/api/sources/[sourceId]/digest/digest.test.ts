import { describe, expect, it, vi } from "vitest";
import { DIGEST_PENDING_WINDOW_MS } from "@/lib/sources/digest";
import type { ChunkPage, SourceRow } from "@/lib/sources/handlers";
import { createSourceDigestHandler, type SourceDigestBackend } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const JOB = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OLD_JOB = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const C1 = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const C2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const GONE = "2a3b4c5d-6e7f-4a8b-9c0d-2e3f4a5b6c7d";
const NOW = Date.parse("2026-11-18T12:00:00Z");

const source: SourceRow = {
  id: SOURCE_ID,
  project_id: "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22",
  source_type: "pdf",
  title: "보고서.pdf",
  status: "completed",
  error_code: null,
  unavailable_at: null,
  original_url: null,
  video_id: null,
  channel_title: null,
  duration_seconds: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const page = (chunks: ChunkPage["chunks"], unavailable = false): ChunkPage => ({ chunks, has_more: false, has_before: false, around: null, unavailable });
const chunk = (id: string, index: number, locator: Record<string, unknown>) => ({ id, chunk_index: index, content: "본문", locator });

const stored = {
  version: 1,
  title: "다이제스트",
  glance: [
    { text: "첫 요점", details: ["세부", 3], chunk_ids: [C1, GONE, C1] },
    { text: "사라진 근거", details: [], chunk_ids: [GONE] },
  ],
  terms: [{ term: "용어", desc: "설명", chunk_ids: [C2] }],
  chapters: [
    { title: "1장", intro: "도입", chunk_ids: [GONE], points: [{ text: "요점", chunk_ids: [C2], subpoints: [{ text: "하위", chunk_ids: [GONE] }] }] },
    { title: "빈 장", intro: "x", chunk_ids: [C1], points: [{ text: "근거 없음", chunk_ids: [GONE], subpoints: [] }] },
  ],
};

const latest = (finishedAgoMs = 60 * 60 * 1000, id = JOB) => ({ id, finished_at: new Date(NOW - finishedAgoMs).toISOString() });

function fakeBackend(over: Partial<SourceDigestBackend> = {}, pages: ChunkPage[] = []): SourceDigestBackend {
  const queue = [...pages];
  return {
    getUserId: vi.fn(async () => "user-1"),
    getSource: vi.fn(async () => source),
    getChunks: vi.fn(async () => ({ ok: true as const, page: queue.shift() ?? page([]) })),
    getDigestRow: vi.fn(async () => null),
    getLatestIngest: vi.fn(async () => latest()),
    ...over,
  };
}

const call = async (backend: SourceDigestBackend, id = SOURCE_ID) => {
  const res = await createSourceDigestHandler(backend, () => NOW)(new Request("http://localhost/"), id);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/sources/:id/digest", () => {
  it("로그인이 없으면 401, 형식이 틀리거나 없는 자료는 404, 백엔드 오류는 500", async () => {
    expect((await call(fakeBackend({ getUserId: async () => null }))).status).toBe(401);
    expect((await call(fakeBackend(), "not-a-uuid")).status).toBe(404);
    expect((await call(fakeBackend({ getSource: async () => null }))).status).toBe(404);
    expect((await call(fakeBackend({ getDigestRow: async () => Promise.reject(new Error("db")) }))).status).toBe(500);
  });

  it("비활성 자료는 unavailable, url·실패 자료는 none, 처리 중이면 pending(다이제스트를 읽지 않는다)", async () => {
    const cases: Array<[Partial<SourceRow>, Record<string, unknown>]> = [
      [{ unavailable_at: "2026-11-10T00:00:00Z" }, { unavailable: true, status: "none", digest: null }],
      [{ source_type: "url" }, { unavailable: false, status: "none", digest: null }],
      [{ status: "failed" }, { unavailable: false, status: "none", digest: null }],
      [{ status: "processing" }, { unavailable: false, status: "pending", digest: null }],
    ];
    for (const [over, expected] of cases) {
      const backend = fakeBackend({ getSource: async () => ({ ...source, ...over }) });
      expect((await call(backend)).body).toEqual(expected);
      expect(backend.getDigestRow).not.toHaveBeenCalled();
    }
  });

  it("행이 없으면 최근 완료면 pending, 오래됐으면 none(기존 자료). 행의 작업이 최신이 아니면 pending, failed 행은 failed", async () => {
    expect((await call(fakeBackend({ getLatestIngest: async () => latest(60_000) }))).body.status).toBe("pending");
    // 경계: 완료 뒤 10분 미만은 pending, 정확히 10분부터 none
    expect((await call(fakeBackend({ getLatestIngest: async () => latest(DIGEST_PENDING_WINDOW_MS - 1) }))).body.status).toBe("pending");
    expect((await call(fakeBackend({ getLatestIngest: async () => latest(DIGEST_PENDING_WINDOW_MS) }))).body.status).toBe("none");
    expect((await call(fakeBackend({ getLatestIngest: async () => latest(DIGEST_PENDING_WINDOW_MS + 1) }))).body.status).toBe("none");
    expect(DIGEST_PENDING_WINDOW_MS).toBe(10 * 60 * 1000);
    expect((await call(fakeBackend({ getLatestIngest: async () => null }))).body.status).toBe("none");
    const staleRow = fakeBackend({ getDigestRow: async () => ({ job_id: OLD_JOB, status: "ready", digest: stored }) });
    expect((await call(staleRow)).body).toEqual({ unavailable: false, status: "pending", digest: null });
    expect(staleRow.getChunks).not.toHaveBeenCalled();
    expect((await call(fakeBackend({ getDigestRow: async () => ({ job_id: JOB, status: "failed", digest: null }) }))).body.status).toBe("failed");
  });

  it("ready: 인용을 지금 있는 청크의 쪽·시각으로 바꾸고 인용이 없어진 항목·요점 없는 장은 버린다", async () => {
    const backend = fakeBackend({ getDigestRow: async () => ({ job_id: JOB, status: "ready", digest: stored }) }, [
      page([chunk(C1, 0, { page: 2 }), chunk(C2, 1, { t_start: 12.5, t_end: 20 })]),
    ]);
    const { body } = await call(backend);
    const c1 = { chunk_id: C1, t_start: null, page: 2 };
    const c2 = { chunk_id: C2, t_start: 12.5, page: null };
    expect(body).toEqual({
      unavailable: false,
      status: "ready",
      digest: {
        version: 1,
        title: "다이제스트",
        glance: [{ text: "첫 요점", details: ["세부"], citations: [c1] }],
        terms: [{ term: "용어", desc: "설명", citations: [c2] }],
        chapters: [{ title: "1장", intro: "도입", citations: [], points: [{ text: "요점", citations: [c2], subpoints: [] }] }],
      },
    });
  });

  it("청크를 읽는 중 비활성이면 unavailable, 남은 항목이 없으면 failed", async () => {
    const row = async () => ({ job_id: JOB, status: "ready", digest: stored });
    expect((await call(fakeBackend({ getDigestRow: row }, [page([], true)]))).body).toEqual({ unavailable: true, status: "none", digest: null });
    expect((await call(fakeBackend({ getDigestRow: row }, [page([])]))).body).toEqual({ unavailable: false, status: "failed", digest: null });
  });
});
