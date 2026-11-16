import { describe, expect, it } from "vitest";
import {
  createStubVideoSummaryProvider,
  hasVerbatimRun,
  processSummarySentences,
  runVideoSummaryStep,
  sampleChunks,
  type SummaryChunk,
  type SummarySentence,
  type SummaryStore,
  type VideoSummaryProvider,
} from "./video-summary.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mkChunks = (n: number, text = (i: number) => `청크 ${i} 내용입니다.`): SummaryChunk[] =>
  Array.from({ length: n }, (_, i) => ({ chunk_id: uuid(i + 1), chunk_index: i, content: text(i) }));

describe("sampleChunks", () => {
  it("영상 전체에서 고르게 뽑는다(앞부분만이 아님)", () => {
    const all = mkChunks(100);
    const s = sampleChunks(all, { maxInputChunks: 5, maxInputChars: 20_000 } as never);
    expect(s.map((c) => c.chunk_index)).toEqual([0, 25, 50, 74, 99]);
    expect(s[0]!.chunk_index).toBe(0);
    expect(s.at(-1)!.chunk_index).toBe(99);
  });
  it("적으면 전부, 비면 빈 배열, 글자 상한을 지킨다", () => {
    expect(sampleChunks(mkChunks(3))).toHaveLength(3);
    expect(sampleChunks([])).toEqual([]);
    const big = mkChunks(10, () => "가".repeat(100));
    const s = sampleChunks(big, { maxInputChunks: 10, maxInputChars: 350 } as never);
    expect(s.length).toBeLessThanOrEqual(3);
  });
});

describe("hasVerbatimRun", () => {
  const src = "가나다라마바사아자차카타파하".repeat(10); // 140자
  it("100자 이상 연속 일치면 true, 99자면 false", () => {
    expect(hasVerbatimRun(src.slice(0, 100), src)).toBe(true);
    expect(hasVerbatimRun(src.slice(0, 99), src)).toBe(false);
  });
  it("중간이 달라 연속이 100자 미만이면 false", () => {
    const s = src.slice(0, 60) + "X" + src.slice(61, 120);
    expect(hasVerbatimRun(s, src)).toBe(false);
  });
});

describe("processSummarySentences", () => {
  const chunks = mkChunks(3, (i) => `서로 다른 첫번째 청크 ${i} 본문`);
  const [a, b] = chunks as [SummaryChunk, SummaryChunk];
  const OUTSIDE = uuid(99);

  it("거부된 ID는 빼고 유효 인용이 있으면 문장을 남긴다", () => {
    const r = processSummarySentences([{ text: "요약 문장", chunk_ids: [a.chunk_id, OUTSIDE, "not-uuid", a.chunk_id] }], chunks);
    expect(r.sentences).toEqual([{ text: "요약 문장", chunk_ids: [a.chunk_id] }]);
    expect(r.rejectedIds).toBe(2);
  });
  it("유효 인용이 0건이거나 형식이 틀린 문장은 버린다", () => {
    const r = processSummarySentences(
      [{ text: "x", chunk_ids: [OUTSIDE] }, { text: "y", chunk_ids: [] }, { text: "z" }, { text: "", chunk_ids: [a.chunk_id] }, "str", null],
      chunks,
    );
    expect(r.sentences).toEqual([]);
    expect(r.dropped.noCitation).toBe(3);
    expect(r.dropped.malformed).toBe(3);
  });
  it("청크와 100자 연속 일치하는 문장은 버린다", () => {
    const long = Array.from({ length: 30 }, (_, i) => `단어${i}`).join(" ");
    const withLong: SummaryChunk[] = [{ chunk_id: a.chunk_id, chunk_index: 0, content: `앞 ${long} 뒤` }, b];
    const r = processSummarySentences([{ text: long, chunk_ids: [a.chunk_id] }, { text: "짧은 요약", chunk_ids: [b.chunk_id] }], withLong);
    expect(long.length).toBeGreaterThanOrEqual(100);
    expect(r.sentences.map((s) => s.text)).toEqual(["짧은 요약"]);
    expect(r.dropped.verbatim).toBe(1);
  });
  it("배열이 아니면 빈 결과", () => {
    expect(processSummarySentences({ text: "x" }, chunks).sentences).toEqual([]);
  });
});

describe("runVideoSummaryStep", () => {
  const ctx = { jobId: "job-1", sourceId: "src-1", userId: "u", projectId: "p" };
  function setup(all: SummaryChunk[], provider: VideoSummaryProvider) {
    const saved: { jobId: string; sentences: SummarySentence[]; model: string }[] = [];
    const usage: unknown[] = [];
    const store: SummaryStore = {
      loadChunks: async () => all,
      saveSourceSummary: async (jobId, sentences, model) => {
        saved.push({ jobId, sentences, model });
        return true;
      },
    };
    return { saved, usage, deps: { store, provider, recordUsage: async (e: unknown) => void usage.push(e) } };
  }

  it("스텁은 실제 chunk_id를 인용해 저장한다", async () => {
    const all = mkChunks(10);
    const { saved, usage, deps } = setup(all, createStubVideoSummaryProvider());
    expect(await runVideoSummaryStep(deps, ctx)).toBe("saved");
    expect(saved).toHaveLength(1);
    const ids = new Set(all.map((c) => c.chunk_id));
    expect(saved[0]!.sentences.length).toBeGreaterThan(0);
    for (const s of saved[0]!.sentences) for (const id of s.chunk_ids) expect(ids.has(id)).toBe(true);
    expect(saved[0]!.model).toBe("stub-video-summary-v1");
    expect(usage).toHaveLength(1);
  });

  it("allowedChunks는 실제로 보낸 표본이다: 표본 밖 청크 인용은 거부", async () => {
    const all = mkChunks(200);
    let sent: SummaryChunk[] = [];
    const provider: VideoSummaryProvider = {
      name: "t",
      model: "t",
      summarize: async (p) => {
        sent = p.chunks;
        const outside = all.find((c) => !p.chunks.includes(c))!;
        return { sentences: [{ text: "표본 밖", chunk_ids: [outside.chunk_id] }, { text: "표본 안", chunk_ids: [p.chunks[0]!.chunk_id] }] };
      },
    };
    const { saved, deps } = setup(all, provider);
    expect(await runVideoSummaryStep(deps, ctx)).toBe("saved");
    expect(sent.length).toBeLessThan(200);
    expect(saved[0]!.sentences.map((s) => s.text)).toEqual(["표본 안"]);
  });

  it("전부 버려지면 저장하지 않는다", async () => {
    const provider: VideoSummaryProvider = { name: "t", model: "t", summarize: async () => ({ sentences: [{ text: "근거 없음", chunk_ids: [uuid(99)] }] }) };
    const { saved, usage, deps } = setup(mkChunks(3), provider);
    expect(await runVideoSummaryStep(deps, ctx)).toBe("empty");
    expect(saved).toEqual([]);
    expect(usage).toHaveLength(1);
  });

  it("사용 기록 실패는 요약 저장을 막지 않는다(저장 뒤 오류만 올린다)", async () => {
    const { saved, deps } = setup(mkChunks(4), createStubVideoSummaryProvider());
    deps.recordUsage = async () => {
      throw new Error("usage_down");
    };
    await expect(runVideoSummaryStep(deps, ctx)).rejects.toThrow("usage_down");
    expect(saved).toHaveLength(1);
  });

  it("대문자 UUID 인용은 거부된다(소문자만 인정하는 계약)", async () => {
    const provider: VideoSummaryProvider = {
      name: "t",
      model: "t",
      summarize: async (p) => ({ sentences: [{ text: "대문자", chunk_ids: [p.chunks[0]!.chunk_id.toUpperCase()] }] }),
    };
    const all = mkChunks(2).map((c, i) => ({ ...c, chunk_id: `aaaaaaaa-0000-4000-8000-00000000000${i}` }));
    const { saved, deps } = setup(all, provider);
    expect(await runVideoSummaryStep(deps, ctx)).toBe("empty");
    expect(saved).toEqual([]);
  });

  it("청크가 없으면 공급자를 부르지 않는다", async () => {
    let called = false;
    const provider: VideoSummaryProvider = { name: "t", model: "t", summarize: async () => ((called = true), { sentences: [] }) };
    const { deps } = setup([], provider);
    expect(await runVideoSummaryStep(deps, ctx)).toBe("no_chunks");
    expect(called).toBe(false);
  });
});
