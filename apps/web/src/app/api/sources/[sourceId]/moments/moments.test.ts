import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "@/lib/sources/handlers";
import { createMomentsHandler, type MomentsBackend } from "./handler";

const SOURCE = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const CHUNK = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

const row: SourceRow = {
  id: SOURCE,
  project_id: "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22",
  source_type: "youtube",
  title: "강연‮",
  status: "completed",
  error_code: null,
  unavailable_at: null,
  original_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  video_id: "dQw4w9WgXcQ",
  channel_title: "채널",
  duration_seconds: 100,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

function setup(over: Partial<MomentsBackend> = {}, enabled = true) {
  const backend: MomentsBackend = {
    getUserId: vi.fn(async () => "u1"),
    getSource: vi.fn(async () => row),
    getMoments: vi.fn(async () => [
      { id: "m1", moment_index: 0, locator: { t_start: 10, t_end: 20 }, title: "장​면", description: "설명" },
      { id: "m2", moment_index: 1, locator: { t_start: 30, t_end: 30 }, title: "잘못", description: "구간 없음" },
    ]),
    getSummary: vi.fn(async () => ({
      sentences: [
        { text: "요약⁦문장", chunk_ids: [CHUNK], citations: [{ chunk_id: CHUNK, t_start: 61 }] },
        { text: "인용 위치 없음", chunk_ids: ["11111111-1111-4111-8111-111111111111"], citations: [] },
        { text: "citations 없음(옛 저장분)", chunk_ids: [CHUNK] },
      ],
      model: "stub",
    })),
    ...over,
  };
  return { backend, handler: createMomentsHandler({ backend, enabled: () => enabled }) };
}

const call = (handler: ReturnType<typeof setup>["handler"], id = SOURCE) => handler(new Request("http://localhost/"), id);

describe("A-07 /moments", () => {
  it("로그인 없으면 401", async () => {
    const { handler } = setup({ getUserId: vi.fn(async () => null) });
    expect((await call(handler)).status).toBe(401);
  });

  it("플래그가 꺼지면 {enabled:false}만 주고 DB를 읽지 않는다", async () => {
    const { handler, backend } = setup({}, false);
    const res = await call(handler);
    expect(await res.json()).toEqual({ enabled: false });
    expect(backend.getSource).not.toHaveBeenCalled();
  });

  it("장면·요약을 정리해 준다(제어 문자 제거, 잘못된 구간 제외, 시각은 청크 locator에서)", async () => {
    const { handler } = setup();
    const data = await (await call(handler)).json();
    expect(data.unavailable).toBe(false);
    expect(data.source.title).toBe("강연");
    expect(data.moments).toEqual([{ id: "m1", moment_index: 0, t_start: 10, t_end: 20, title: "장면", description: "설명" }]);
    expect(data.summary.sentences[0]).toEqual({ text: "요약문장", citations: [{ chunk_id: CHUNK, t_start: 61 }] });
    expect(data.summary.sentences).toHaveLength(1); // 유효 인용 0건 문장은 제거
  });

  it("남는 문장이 없으면 summary는 null", async () => {
    const { handler } = setup({ getSummary: vi.fn(async () => ({ sentences: [{ text: "x", chunk_ids: [CHUNK], citations: [] }], model: "stub" })) });
    expect((await (await call(handler)).json()).summary).toBeNull();
  });

  it("비활성 자료는 메타와 unavailable:true만", async () => {
    const { handler, backend } = setup({ getSource: vi.fn(async () => ({ ...row, unavailable_at: "2026-11-10T00:00:00Z" })) });
    const data = await (await call(handler)).json();
    expect(data).toEqual({
      enabled: true,
      unavailable: true,
      source: { id: SOURCE, title: "강연", channel_title: "채널", original_url: row.original_url },
    });
    expect(backend.getMoments).not.toHaveBeenCalled();
    expect(backend.getSummary).not.toHaveBeenCalled();
  });

  it("없는 자료·유튜브가 아닌 자료·잘못된 id는 404", async () => {
    expect((await call(setup({ getSource: vi.fn(async () => null) }).handler)).status).toBe(404);
    expect((await call(setup({ getSource: vi.fn(async () => ({ ...row, source_type: "pdf" })) }).handler)).status).toBe(404);
    expect((await call(setup().handler, "nope")).status).toBe(404);
  });

  it("읽기 실패는 500", async () => {
    const { handler } = setup({ getMoments: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await call(handler)).status).toBe(500);
  });
});
