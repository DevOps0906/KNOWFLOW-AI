import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogFields } from "../log.js";
import type { StoredChunk } from "../youtube/summary.js";
import {
  buildDigestPrompt,
  checkDigest,
  createStubDigestProvider,
  runDigestStep,
  type Digest,
  type DigestProvider,
  type DigestStore,
} from "./digest.js";
import { createGeminiDigestProvider, createGeminiSummaryProvider, createGeminiVideoSummaryProvider, DIGEST_SCHEMA } from "./gemini-summary.js";
import { DIGEST_SETTINGS, SUMMARY_GEMINI_SETTINGS } from "./settings.js";
import { buildSummaryPrompt } from "./summary.js";
import type { UsageEvent } from "./store.js";

const idOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const pdfChunks = (n: number): StoredChunk[] =>
  Array.from({ length: n }, (_, i) => ({ chunk_id: idOf(i), content: `본문 ${i} `.repeat(5), locator: { page: i + 1 } }));

const refs = new Map([
  ["c1", idOf(0)],
  ["c2", idOf(1)],
]);
const LONG_SOURCE = "가나다라마바사아자차카타파하".repeat(12);

/** 유효한 공급자 출력(ref 인용) */
const rawDigest = () => ({
  title: " 문서 다이제스트 ",
  glance: [
    { text: "첫 요점", details: ["세부"], chunk_ids: ["c1"] },
    { text: "둘째 요점", details: [], chunk_ids: ["c2", "c2", "c9"] },
  ],
  terms: [{ term: "용어", desc: "설명", chunk_ids: ["c1"] }],
  chapters: [
    { title: "1장", intro: "도입", chunk_ids: ["c1"], points: [{ text: "요점", chunk_ids: ["c2"], subpoints: [{ text: "하위", chunk_ids: ["c1"] }] }] },
  ],
});

describe("buildDigestPrompt", () => {
  it("위치가 있는 청크만 최대 60개 고르게 고르고 c1… 번호만 보낸다(UUID는 보내지 않는다)", () => {
    const chunks = [...pdfChunks(100), { chunk_id: idOf(999), content: "위치 없음", locator: {} }];
    const { prompt, idByRef } = buildDigestPrompt(chunks, "pdf");
    expect(prompt.chunks.length).toBe(DIGEST_SETTINGS.maxInputChunks);
    expect(prompt.chunks[0]).toMatchObject({ ref: "c1", page: 1 });
    expect(prompt.chunks.at(-1)).toMatchObject({ ref: "c60", page: 100 });
    expect(idByRef.get("c60")).toBe(idOf(99));
    expect(JSON.stringify(prompt)).not.toContain("00000000-0000");
    const total = prompt.chunks.reduce((n, c) => n + c.content.length, 0);
    expect(total).toBeLessThanOrEqual(DIGEST_SETTINGS.maxInputChars);
  });

  it("유튜브는 시각 구간 청크만 보낸다", () => {
    const chunks: StoredChunk[] = [
      { chunk_id: idOf(0), content: "전사", locator: { t_start: 0, t_end: 10 } },
      { chunk_id: idOf(1), content: "쪽", locator: { page: 1 } },
    ];
    const { prompt } = buildDigestPrompt(chunks, "youtube");
    expect(prompt.chunks).toEqual([{ ref: "c1", t_start: 0, t_end: 10, content: "전사" }]);
  });
});

describe("checkDigest", () => {
  it("ref를 UUID로 되돌리고(모르는 ref·중복 제거) version 1을 붙인다", () => {
    const { digest, reason } = checkDigest(rawDigest(), refs, ["a", "b"]);
    expect(reason).toBeNull();
    expect(digest).toEqual({
      version: 1,
      title: "문서 다이제스트",
      glance: [
        { text: "첫 요점", details: ["세부"], chunk_ids: [idOf(0)] },
        { text: "둘째 요점", details: [], chunk_ids: [idOf(1)] },
      ],
      terms: [{ term: "용어", desc: "설명", chunk_ids: [idOf(0)] }],
      chapters: [
        { title: "1장", intro: "도입", chunk_ids: [idOf(0)], points: [{ text: "요점", chunk_ids: [idOf(1)], subpoints: [{ text: "하위", chunk_ids: [idOf(0)] }] }] },
      ],
    } satisfies Digest);
  });

  it("인용 없는 항목·긴 원문 인용·길이 초과는 버리고, 요점이 모두 빠진 장은 장째 버린다", () => {
    const raw = rawDigest();
    raw.glance.push({ text: "근거 없음", details: [], chunk_ids: ["c7"] }, { text: LONG_SOURCE, details: [], chunk_ids: ["c1"] });
    raw.glance[0]!.details.push("가".repeat(201), LONG_SOURCE);
    raw.terms.push({ term: "가".repeat(41), desc: "설명", chunk_ids: ["c1"] });
    raw.chapters.push({ title: "빈 장", intro: "x", chunk_ids: ["c1"], points: [{ text: "근거 없음", chunk_ids: [], subpoints: [] }] });
    raw.chapters[0]!.intro = LONG_SOURCE;
    const { digest, dropped } = checkDigest(raw, refs, [LONG_SOURCE]);
    expect(digest?.glance.map((g) => g.text)).toEqual(["첫 요점", "둘째 요점"]);
    expect(digest?.glance[0]!.details).toEqual(["세부"]);
    expect(digest?.terms.length).toBe(1);
    expect(digest?.chapters.map((c) => c.title)).toEqual(["1장"]);
    // 원문을 그대로 옮긴 도입 문단은 비운다
    expect(digest?.chapters[0]!.intro).toBe("");
    expect(dropped).toBe(7);
  });

  it("상한 밖 항목은 자르고, glance<2·장<1·제목 불량·객체 아님이면 전체 거부", () => {
    const many = rawDigest();
    many.glance = Array.from({ length: 8 }, (_, i) => ({ text: `요점 ${i}`, details: [], chunk_ids: ["c1"] }));
    expect(checkDigest(many, refs, []).digest?.glance.length).toBe(DIGEST_SETTINGS.maxGlance);

    const one = rawDigest();
    one.glance[1]!.chunk_ids = [];
    expect(checkDigest(one, refs, []).reason).toBe("glance_too_few");
    const noCh = rawDigest();
    noCh.chapters[0]!.points = [];
    expect(checkDigest(noCh, refs, []).reason).toBe("chapters_too_few");
    expect(checkDigest({ ...rawDigest(), title: "가".repeat(121) }, refs, []).reason).toBe("title_invalid");
    expect(checkDigest(null, refs, []).reason).toBe("not_object");
    expect(checkDigest([], refs, []).reason).toBe("not_object");
  });

  it("필수 키 누락·타입 불일치는 빈 배열로 넘기지 않고 형식 불량(malformed)으로 전체 거부한다", () => {
    const variants: Array<(d: Record<string, unknown> & ReturnType<typeof rawDigest>) => void> = [
      (d) => delete (d as Record<string, unknown>).title,
      (d) => ((d as Record<string, unknown>).title = 3),
      (d) => ((d as Record<string, unknown>).glance = "x"),
      (d) => delete (d as Record<string, unknown>).terms,
      (d) => ((d as Record<string, unknown>).chapters = {}),
      (d) => delete (d.glance[0] as Record<string, unknown>).details,
      (d) => ((d.glance[0] as Record<string, unknown>).details = "세부"),
      (d) => ((d.glance[0] as Record<string, unknown>).details = [1]),
      (d) => ((d.glance as unknown[])[1] = "문장"),
      (d) => ((d.terms[0] as Record<string, unknown>).chunk_ids = "c1"),
      (d) => delete (d.terms[0] as Record<string, unknown>).desc,
      (d) => delete (d.chapters[0] as Record<string, unknown>).intro,
      (d) => ((d.chapters[0] as Record<string, unknown>).points = null),
      (d) => delete (d.chapters[0]!.points[0] as Record<string, unknown>).subpoints,
      (d) => ((d.chapters[0]!.points[0]!.subpoints as unknown[])[0] = { text: "하위" }),
      (d) => ((d.chapters[0]!.points[0] as Record<string, unknown>).chunk_ids = [3]),
    ];
    for (const change of variants) {
      const d = rawDigest() as Record<string, unknown> & ReturnType<typeof rawDigest>;
      change(d);
      expect(checkDigest(d, refs, []).reason).toBe("malformed");
    }
  });
});

function memory(chunks: StoredChunk[], ok = true) {
  const saved: { jobId: string; status: string; digest: Digest | null; model: string }[] = [];
  const store: DigestStore = {
    loadChunks: async () => chunks,
    async save(jobId, status, digest, model) {
      saved.push({ jobId, status, digest, model });
      return ok;
    },
  };
  return { store, saved };
}

const source = { id: "s1", project_id: "p1", user_id: "u1", source_type: "pdf" };

describe("runDigestStep", () => {
  it("스텁은 청크가 1개여도 계약 형식의 결정적 다이제스트를 ready로 저장하고 source_digest 사용 기록을 남긴다", async () => {
    for (const n of [1, 2, 7]) {
      const m = memory(pdfChunks(n));
      const usage: UsageEvent[] = [];
      const logs: LogFields[] = [];
      const outcome = await runDigestStep(
        { provider: createStubDigestProvider(), store: m.store, recordUsage: async (e) => void usage.push(e), log: (f) => void logs.push(f) },
        "j1",
        source,
      );
      expect(outcome).toBe("saved");
      expect(m.saved[0]).toMatchObject({ jobId: "j1", status: "ready", model: "stub-digest-v1" });
      expect(m.saved[0]!.digest!.glance.length).toBeGreaterThanOrEqual(2);
      expect(m.saved[0]!.digest!.chapters.length).toBeGreaterThanOrEqual(1);
      expect(usage).toEqual([expect.objectContaining({ eventType: "source_digest", provider: "stub" })]);
      expect(logs).toContainEqual(expect.objectContaining({ event: "source_digest", outcome: "saved" }));
      const again = memory(pdfChunks(n));
      await runDigestStep({ provider: createStubDigestProvider(), store: again.store, recordUsage: async () => {} }, "j1", source);
      expect(again.saved[0]!.digest).toEqual(m.saved[0]!.digest);
    }
  });

  it("형식 불량이면 failed로 저장하고(invalid) 사용량은 기록한다. 펜싱에 걸리면 rejected, 청크가 없으면 공급자를 부르지 않는다", async () => {
    const garbage: DigestProvider = { name: "x", model: "m", generate: async () => ({ digest: null, inputTokens: 10, outputTokens: 16384 }) };
    const a = memory(pdfChunks(3));
    const usage: UsageEvent[] = [];
    expect(await runDigestStep({ provider: garbage, store: a.store, recordUsage: async (e) => void usage.push(e) }, "j1", source)).toBe("invalid");
    expect(a.saved).toEqual([{ jobId: "j1", status: "failed", digest: null, model: "m" }]);
    expect(usage[0]).toMatchObject({ eventType: "source_digest", outputTokens: 16384 });

    const b = memory(pdfChunks(3), false);
    expect(await runDigestStep({ provider: createStubDigestProvider(), store: b.store, recordUsage: async () => {} }, "j1", source)).toBe("rejected");

    let called = false;
    const spy: DigestProvider = { name: "x", model: "m", generate: async () => ((called = true), { digest: null }) };
    expect(await runDigestStep({ provider: spy, store: memory([]).store, recordUsage: async () => {} }, "j1", source)).toBe("no_chunks");
    expect(called).toBe(false);
  });

  it("사용 기록이 실패해도 상태는 저장하고 오류 이름만 로그에 남긴다", async () => {
    const m = memory(pdfChunks(3));
    const logs: LogFields[] = [];
    const recordUsage = async () => {
      throw new TypeError("usage db down");
    };
    expect(await runDigestStep({ provider: createStubDigestProvider(), store: m.store, recordUsage, log: (f) => void logs.push(f) }, "j1", source)).toBe("saved");
    expect(m.saved[0]!.status).toBe("ready");
    expect(logs).toContainEqual(expect.objectContaining({ event: "source_digest", outcome: "usage_record_failed", errorName: "TypeError" }));
    expect(JSON.stringify(logs)).not.toContain("usage db down");

    const garbage: DigestProvider = { name: "x", model: "m", generate: async () => ({ digest: null }) };
    const f = memory(pdfChunks(3));
    expect(await runDigestStep({ provider: garbage, store: f.store, recordUsage }, "j1", source)).toBe("invalid");
    expect(f.saved).toEqual([{ jobId: "j1", status: "failed", digest: null, model: "m" }]);
  });

  it("공급자 호출이 실패하면 failed를 남기고 오류를 올린다", async () => {
    const broken: DigestProvider = { name: "x", model: "m", generate: async () => { throw new TypeError("network"); } };
    const m = memory(pdfChunks(2));
    await expect(runDigestStep({ provider: broken, store: m.store, recordUsage: async () => {} }, "j1", source)).rejects.toThrow(TypeError);
    expect(m.saved).toEqual([{ jobId: "j1", status: "failed", digest: null, model: "m" }]);
  });
});

describe("Gemini 다이제스트 공급자", () => {
  afterEach(() => vi.restoreAllMocks());

  it("타임아웃: 다이제스트는 120초, 프로젝트 요약·영상 요약은 60초를 실제로 건다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchFn = (async () => new Response(body("{}"), { status: 200 })) as unknown as typeof fetch;
    await createGeminiDigestProvider({ apiKey: "AIza-test", fetch: fetchFn }).generate(buildDigestPrompt(pdfChunks(2), "pdf").prompt);
    expect(timeout).toHaveBeenLastCalledWith(120_000);
    expect(DIGEST_SETTINGS.gemini.requestTimeoutMs).toBe(120_000);
    await createGeminiSummaryProvider({ apiKey: "AIza-test", fetch: fetchFn }).summarize(buildSummaryPrompt(["본문"]));
    expect(timeout).toHaveBeenLastCalledWith(SUMMARY_GEMINI_SETTINGS.requestTimeoutMs);
    await createGeminiVideoSummaryProvider({ apiKey: "AIza-test", fetch: fetchFn }).summarize({ system: "s", chunks: [] });
    expect(timeout).toHaveBeenLastCalledWith(60_000);
  });

  const body = (text: string, finishReason = "STOP") =>
    JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 9 } });

  it("출력 16384토큰·thinking 0·다이제스트 스키마로 c… 번호 청크만 보내고, 결과·사용량을 돌려준다", async () => {
    const calls: RequestInit[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(body(JSON.stringify(rawDigest())), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createGeminiDigestProvider({ apiKey: "AIza-test", model: "gemini-test", fetch: fetchFn });
    const { prompt } = buildDigestPrompt(pdfChunks(3), "pdf");
    const r = await p.generate(prompt);
    expect(r).toMatchObject({ digest: rawDigest(), inputTokens: 50, outputTokens: 9 });
    const sent = JSON.parse(String(calls[0]!.body)) as { generationConfig: Record<string, unknown>; contents: { parts: { text: string }[] }[] };
    expect(sent.generationConfig).toMatchObject({ maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 }, responseSchema: DIGEST_SCHEMA });
    expect(sent.contents[0]!.parts[0]!.text).toContain('"ref":"c1"');
    expect(sent.contents[0]!.parts[0]!.text).not.toContain("00000000-0000");
  });

  it("MAX_TOKENS면 digest null(검증이 거부해 failed로 저장된다)", async () => {
    const fetchFn = (async () => new Response(body("{\"title\":", "MAX_TOKENS"), { status: 200 })) as unknown as typeof fetch;
    const r = await createGeminiDigestProvider({ apiKey: "AIza-test", fetch: fetchFn }).generate(buildDigestPrompt(pdfChunks(2), "pdf").prompt);
    expect(r.digest).toBeNull();
    expect(r.outputTokens).toBe(9);
  });
});
