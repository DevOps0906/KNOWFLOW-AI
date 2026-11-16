import { describe, expect, it, vi } from "vitest";
import type { ChunkPage, ChunksResult, SourceRow } from "@/lib/sources/handlers";
import { createMomentsHandler, MOMENT_CHUNK_PAGE, toMoments, toSummary, type MomentRow, type MomentsBackend } from "./handler";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const C1 = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const C2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const NOT_SEARCHED = "2a3b4c5d-6e7f-4a8b-9c0d-2e3f4a5b6c7d";

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

const page = (over: Partial<ChunkPage> = {}): ChunkPage => ({
  chunks: [
    { id: C1, chunk_index: 0, content: "전사 1", locator: { t_start: 0, t_end: 60 } },
    { id: C2, chunk_index: 1, content: "전사 2", locator: { t_start: 60, t_end: 120 } },
  ],
  has_more: false,
  has_before: false,
  around: null,
  unavailable: false,
  ...over,
});

const moment = (id: string, t_start: number, t_end: number): MomentRow => ({
  id,
  moment_index: 0,
  locator: { t_start, t_end },
  title: "장면",
  description: "설명",
});

function backend(over: Partial<MomentsBackend> = {}): MomentsBackend {
  return {
    getUserId: async () => "u1",
    getSource: async () => source(),
    getChunks: async (): Promise<ChunksResult> => ({ ok: true, page: page() }),
    listMoments: async () => [moment("m1", 30, 90), moment("m2", 120, 150)],
    getSummarySentences: async () => [
      { text: "앞부분 요약", chunk_ids: [C1, NOT_SEARCHED] },
      { text: "검색되지 않은 인용만", chunk_ids: [NOT_SEARCHED] },
    ],
    ...over,
  };
}

const call = (b: MomentsBackend, enabled = true, id = SOURCE_ID) =>
  createMomentsHandler({ backend: b, youtubeEnabled: () => enabled })(new Request("http://localhost/"), id);

describe("A-07 /moments", () => {
  it("장면 카드·요약을 주고, 겹치는 청크가 없는 카드는 인용 불가로 표시한다(맞닿음은 겹침 아님)", async () => {
    const res = await call(backend());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.unavailable).toBe(false);
    expect(body.moments.map((m: { id: string; citable: boolean }) => [m.id, m.citable])).toEqual([
      ["m1", true],
      ["m2", false],
    ]);
    // 응답에 전사 본문을 넣지 않는다
    expect(JSON.stringify(body)).not.toContain("전사 1");
  });

  it("검색되지 않은(그 자료의 청크가 아닌) chunk_id 인용은 거부하고, 유효 인용 0건 문장은 버린다", async () => {
    const body = await (await call(backend())).json();
    expect(body.summary).toEqual([{ text: "앞부분 요약", citations: [{ chunk_id: C1, t_start: 0 }] }]);
  });

  it("플래그가 꺼지면 {enabled:false}만 주고 DB를 읽지 않는다", async () => {
    const getSource = vi.fn(async () => source());
    const res = await call(backend({ getSource }), false);
    expect(await res.json()).toEqual({ enabled: false });
    expect(getSource).not.toHaveBeenCalled();
  });

  it("unavailable_at 자료는 장면·요약 없이 unavailable=true만 준다(장면 0건과 구분)", async () => {
    const listMoments = vi.fn(async () => [moment("m1", 0, 10)]);
    const getSummarySentences = vi.fn(async () => null);
    const res = await call(backend({ getSource: async () => source({ unavailable_at: "2026-11-10T00:00:00Z" }), listMoments, getSummarySentences }));
    expect(await res.json()).toEqual({ enabled: true, unavailable: true });
    expect(listMoments).not.toHaveBeenCalled();
    expect(getSummarySentences).not.toHaveBeenCalled();
    // RPC가 비활성으로 판정해도 같다
    const res2 = await call(backend({ getChunks: async () => ({ ok: true, page: page({ chunks: [], unavailable: true }) }) }));
    expect(await res2.json()).toEqual({ enabled: true, unavailable: true });
  });

  it("장면이 없으면 moments=[](unavailable=false)", async () => {
    const body = await (await call(backend({ listMoments: async () => [], getSummarySentences: async () => null }))).json();
    expect(body).toEqual({ enabled: true, unavailable: false, moments: [], summary: null });
  });

  it("청크 위치를 커서로 끝까지 모은다", async () => {
    const getChunks = vi.fn(async ({ afterIndex }: { afterIndex: number | null }): Promise<ChunksResult> => {
      if (afterIndex === null) return { ok: true, page: page({ chunks: [page().chunks[0]!], has_more: true }) };
      return { ok: true, page: page({ chunks: [page().chunks[1]!] }) };
    });
    const body = await (await call(backend({ getChunks }))).json();
    expect(getChunks).toHaveBeenCalledTimes(2);
    expect(getChunks.mock.calls[1]![0]).toMatchObject({ afterIndex: 0, limit: MOMENT_CHUNK_PAGE });
    expect(body.moments[0].citable).toBe(true);
  });

  it("401 · 404(형식·없음) · 409 미완료 · 500", async () => {
    expect((await call(backend({ getUserId: async () => null }))).status).toBe(401);
    expect((await call(backend(), true, "nope")).status).toBe(404);
    expect((await call(backend({ getSource: async () => null }))).status).toBe(404);
    expect((await call(backend({ getSource: async () => source({ status: "processing" }) }))).status).toBe(409);
    expect((await call(backend({ listMoments: async () => Promise.reject(new Error("x")) }))).status).toBe(500);
  });

  it("유튜브가 아닌 자료는 빈 결과", async () => {
    const body = await (await call(backend({ getSource: async () => source({ source_type: "pdf", video_id: null }) }))).json();
    expect(body).toEqual({ enabled: true, unavailable: false, moments: [], summary: null });
  });

  it("toMoments·toSummary는 잘못된 locator·형식을 버린다", () => {
    expect(toMoments([{ ...moment("bad", 0, 1), locator: { t_start: 5, t_end: 5 } }], [])).toEqual([]);
    expect(toSummary("not array", [])).toBeNull();
    expect(toSummary([{ text: "", chunk_ids: [C1] }], [{ chunk_id: C1, t_start: 0, t_end: 1 }])).toBeNull();
    // 대문자로 바꾼 ID는 정규화하지 않고 거부한다
    expect(toSummary([{ text: "a", chunk_ids: [C1.toUpperCase()] }], [{ chunk_id: C1, t_start: 0, t_end: 1 }])).toBeNull();
  });
});
