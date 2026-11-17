import { describe, expect, it, vi } from "vitest";
import type { ChunkPage, SourceRow } from "@/lib/sources/handlers";
import { createSourceSummaryHandler, type SourceSummaryBackend } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const C1 = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const C2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const GONE = "2a3b4c5d-6e7f-4a8b-9c0d-2e3f4a5b6c7d";

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

const chunk = (id: string, index: number, page: unknown) => ({ id, chunk_index: index, content: "본문", locator: { page, char_start: 0, char_end: 2 } });
const page = (chunks: ChunkPage["chunks"], has_more = false, unavailable = false): ChunkPage => ({ chunks, has_more, has_before: false, around: null, unavailable });

function fakeBackend(over: Partial<SourceSummaryBackend> = {}, pages: ChunkPage[] = []): SourceSummaryBackend {
  const queue = [...pages];
  return {
    getUserId: vi.fn(async () => "user-1"),
    getSource: vi.fn(async () => source),
    getChunks: vi.fn(async () => ({ ok: true as const, page: queue.shift() ?? page([]) })),
    getSummarySentences: vi.fn(async () => null),
    ...over,
  };
}

const call = async (backend: SourceSummaryBackend, id = SOURCE_ID) => {
  const res = await createSourceSummaryHandler(backend)(new Request("http://localhost/"), id);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/sources/:id/summary (PDF 자료 요약)", () => {
  it("로그인이 없으면 401, 형식이 틀리거나 없는 자료는 404", async () => {
    expect((await call(fakeBackend({ getUserId: async () => null }))).status).toBe(401);
    expect((await call(fakeBackend(), "not-a-uuid")).status).toBe(404);
    expect((await call(fakeBackend({ getSource: async () => null }))).status).toBe(404);
  });

  it("비활성 자료는 요약을 읽지 않고 unavailable:true", async () => {
    const backend = fakeBackend({ getSource: async () => ({ ...source, unavailable_at: "2026-11-10T00:00:00Z" }) });
    expect((await call(backend)).body).toEqual({ unavailable: true, summary: null });
    expect(backend.getSummarySentences).not.toHaveBeenCalled();
  });

  it("PDF가 아니거나(유튜브·url) 완료 전이면 요약 없음", async () => {
    for (const over of [{ source_type: "youtube" }, { source_type: "url" }, { status: "processing" }]) {
      const backend = fakeBackend({ getSource: async () => ({ ...source, ...over }) });
      expect((await call(backend)).body).toEqual({ unavailable: false, summary: null });
      expect(backend.getSummarySentences).not.toHaveBeenCalled();
    }
  });

  it("요약이 없으면 청크를 읽지 않고 summary:null", async () => {
    const backend = fakeBackend();
    expect((await call(backend)).body).toEqual({ unavailable: false, summary: null });
    expect(backend.getChunks).not.toHaveBeenCalled();
  });

  it("인용을 지금 있는 청크의 쪽으로 바꾸고 인용이 없어진 문장은 버린다(청크는 끝까지 이어 읽는다)", async () => {
    const backend = fakeBackend(
      {
        getSummarySentences: async () => [
          { text: "첫 문장", chunk_ids: [C1, GONE, C2, C1] },
          { text: "사라진 근거", chunk_ids: [GONE] },
          { text: 3, chunk_ids: [C1] },
          "잘못된 항목",
        ],
      },
      [page([chunk(C1, 0, 2)], true), page([chunk(C2, 1, "x")])],
    );
    const { body } = await call(backend);
    expect(body).toEqual({
      unavailable: false,
      summary: { sentences: [{ text: "첫 문장", citations: [{ chunk_id: C1, page: 2 }, { chunk_id: C2, page: null }] }] },
    });
    expect(backend.getChunks).toHaveBeenCalledTimes(2);
  });

  it("청크를 읽는 중 비활성으로 바뀌면 unavailable:true, 백엔드 오류는 500", async () => {
    const raw = async () => [{ text: "문장", chunk_ids: [C1] }];
    expect((await call(fakeBackend({ getSummarySentences: raw }, [page([], false, true)]))).body).toEqual({ unavailable: true, summary: null });
    expect((await call(fakeBackend({ getSummarySentences: async () => Promise.reject(new Error("db")) }))).status).toBe(500);
  });
});
