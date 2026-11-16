import { describe, expect, it, vi } from "vitest";
import type { ChunkPage, SourceRow } from "@/lib/sources/handlers";
import { createMomentsHandler, type MomentRow, type MomentsBackend } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const C1 = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const C2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const GONE = "2a3b4c5d-6e7f-4a8b-9c0d-2e3f4a5b6c7d";

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

const chunk = (id: string, index: number, t_start: number, t_end: number) => ({ id, chunk_index: index, content: "전사", locator: { t_start, t_end } });

const moments: MomentRow[] = [
  { id: "m0", moment_index: 0, locator: { t_start: 10, t_end: 20 }, title: "도입", description: "설명" },
  // 청크 끝(60)과 맞닿기만 한다 → 인용 불가
  { id: "m1", moment_index: 1, locator: { t_start: 60, t_end: 70 }, title: "끝", description: "설명" },
];

function fakeBackend(over: Partial<MomentsBackend> = {}, pages: ChunkPage[] = []): MomentsBackend {
  const queue = [...pages];
  return {
    getUserId: vi.fn(async () => "user-1"),
    getSource: vi.fn(async () => source),
    getChunks: vi.fn(async () => ({
      ok: true as const,
      page: queue.shift() ?? { chunks: [], has_more: false, has_before: false, around: null, unavailable: false },
    })),
    listMoments: vi.fn(async () => moments),
    getSummarySentences: vi.fn(async () => null),
    ...over,
  };
}

const call = async (backend: MomentsBackend, enabled = true, id = SOURCE_ID) => {
  const res = await createMomentsHandler({ backend, enabled: () => enabled })(new Request("http://localhost/"), id);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("A-07 GET /moments", () => {
  it("플래그가 꺼지면 DB를 읽지 않고 {enabled:false}", async () => {
    const backend = fakeBackend();
    const { status, body } = await call(backend, false);
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: false });
    expect(backend.getSource).not.toHaveBeenCalled();
    expect(backend.listMoments).not.toHaveBeenCalled();
  });

  it("로그인이 없으면 401, 형식이 틀리거나 없는 자료는 404", async () => {
    expect((await call(fakeBackend({ getUserId: async () => null }))).status).toBe(401);
    expect((await call(fakeBackend(), true, "not-a-uuid")).status).toBe(404);
    expect((await call(fakeBackend({ getSource: async () => null }))).status).toBe(404);
  });

  it("unavailable_at 자료는 장면·요약을 읽지 않고 unavailable:true만 준다", async () => {
    const backend = fakeBackend({ getSource: async () => ({ ...source, unavailable_at: "2026-11-10T00:00:00Z" }) });
    const { body } = await call(backend);
    expect(body).toEqual({ enabled: true, unavailable: true, items: [], summary: null });
    expect(backend.listMoments).not.toHaveBeenCalled();
    expect(backend.getSummarySentences).not.toHaveBeenCalled();
  });

  it("청크를 읽는 중 비활성으로 바뀌어도 unavailable:true", async () => {
    const backend = fakeBackend({}, [{ chunks: [], has_more: false, has_before: false, around: null, unavailable: true }]);
    expect((await call(backend)).body).toEqual({ enabled: true, unavailable: true, items: [], summary: null });
  });

  it("유튜브가 아니거나 완료 전이면 빈 목록(unavailable:false)", async () => {
    for (const over of [{ source_type: "pdf" }, { status: "processing" }]) {
      const backend = fakeBackend({ getSource: async () => ({ ...source, ...over }) });
      expect((await call(backend)).body).toEqual({ enabled: true, unavailable: false, items: [], summary: null });
      expect(backend.listMoments).not.toHaveBeenCalled();
    }
  });

  it("장면 카드에 겹침 판정(citable)을 붙이고 청크는 끝까지 이어 읽는다", async () => {
    const backend = fakeBackend({}, [
      { chunks: [chunk(C1, 0, 0, 15)], has_more: true, has_before: false, around: null, unavailable: false },
      { chunks: [chunk(C2, 1, 15, 60)], has_more: false, has_before: true, around: null, unavailable: false },
    ]);
    const { body } = await call(backend);
    expect(body.items).toEqual([
      { id: "m0", moment_index: 0, locator: { t_start: 10, t_end: 20 }, title: "도입", description: "설명", citable: true },
      { id: "m1", moment_index: 1, locator: { t_start: 60, t_end: 70 }, title: "끝", description: "설명", citable: false },
    ]);
    expect(backend.getChunks).toHaveBeenCalledTimes(2);
    expect(backend.getChunks).toHaveBeenLastCalledWith({ sourceId: SOURCE_ID, afterIndex: 0, limit: 100, aroundChunkId: null });
  });

  it("요약은 지금 있는 청크 인용만 남기고 인용이 없어진 문장은 버린다", async () => {
    const backend = fakeBackend(
      {
        listMoments: async () => [],
        getSummarySentences: async () => [
          { text: "첫 문장", chunk_ids: [C1, GONE] },
          { text: "사라진 근거", chunk_ids: [GONE] },
          { text: 3, chunk_ids: [C1] },
          "잘못된 항목",
        ],
      },
      [{ chunks: [chunk(C1, 0, 33, 40)], has_more: false, has_before: false, around: null, unavailable: false }],
    );
    const { body } = await call(backend);
    expect(body.summary).toEqual({ sentences: [{ text: "첫 문장", citations: [{ chunk_id: C1, t_start: 33 }] }] });
  });

  it("백엔드 오류는 500", async () => {
    const backend = fakeBackend({ listMoments: async () => Promise.reject(new Error("db")) });
    expect((await call(backend)).status).toBe(500);
  });
});
