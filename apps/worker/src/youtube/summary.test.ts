import { describe, expect, it } from "vitest";
import type { UsageEvent } from "../ingest/store.js";
import type { LogFields } from "../log.js";
import { VIDEO_SUMMARY_SETTINGS } from "./settings.js";
import {
  buildVideoSummaryPrompt,
  checkVideoSummary,
  createStubVideoSummaryProvider,
  quotesChunk,
  runVideoSummaryStep,
  sampleEvenly,
  type StoredChunk,
  type SummarySentence,
  type VideoSummaryProvider,
  type VideoSummaryStore,
} from "./summary.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stored = (n: number, content = `전사 ${n}번 구간`): StoredChunk => ({ chunk_id: uuid(n), content, locator: { t_start: n * 10, t_end: n * 10 + 10 } });
const chunksOf = (count: number) => Array.from({ length: count }, (_, i) => stored(i));

describe("표본 고르기", () => {
  it("처음부터 끝까지 고른 간격으로 고르고(앞부분만 아님) 적으면 전부", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(sampleEvenly(items, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(sampleEvenly(items, 1)).toEqual([49]);
  });

  it("프롬프트: 시각 구간 청크만, 영상 끝까지 표본, 본문 합계 상한 안", () => {
    const chunks = [...chunksOf(200).map((c) => ({ ...c, content: "가".repeat(1000) })), { chunk_id: uuid(999), content: "쪽", locator: { page: 1 } }];
    const p = buildVideoSummaryPrompt(chunks);
    expect(p.chunks.length).toBe(VIDEO_SUMMARY_SETTINGS.maxInputChunks);
    expect(p.chunks[0]!.chunk_id).toBe(uuid(0));
    expect(p.chunks.at(-1)!.chunk_id).toBe(uuid(199));
    expect(p.chunks.some((c) => "t_start" in c && c.t_start >= 900 && c.t_start <= 1100)).toBe(true);
    expect(p.chunks.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(VIDEO_SUMMARY_SETTINGS.maxInputChars);
    expect(p.chunks.map((c) => c.chunk_id)).not.toContain(uuid(999));
    expect(p.system).not.toContain("가가");
  });
});

describe("PDF 자료 요약 프롬프트", () => {
  it("쪽(page) 청크만 고르게 뽑고 문서용 지시문을 쓴다. 스텁은 쪽 번호로 인용한다", async () => {
    const pages = Array.from({ length: 40 }, (_, i): StoredChunk => ({ chunk_id: uuid(i), content: `본문 ${i}`, locator: { page: i + 1, char_start: 0, char_end: 4 } }));
    const chunks = [...pages, stored(500), { chunk_id: uuid(501), content: "x", locator: { page: 0 } }];
    const p = buildVideoSummaryPrompt(chunks, "pdf");
    expect(p.chunks.length).toBe(VIDEO_SUMMARY_SETTINGS.maxInputChunks);
    expect(p.chunks[0]).toEqual({ chunk_id: uuid(0), page: 1, content: "본문 0" });
    expect(p.chunks.at(-1)!.chunk_id).toBe(uuid(39));
    expect(p.chunks.map((c) => c.chunk_id)).not.toContain(uuid(500));
    expect(p.chunks.map((c) => c.chunk_id)).not.toContain(uuid(501));
    expect(p.system).toContain("문서");
    expect(p.system).not.toContain("영상");
    expect(buildVideoSummaryPrompt(chunks).system).toContain("영상 전사");
    const out = await createStubVideoSummaryProvider().summarize(p);
    expect((out.sentences as { text: string }[])[0]!.text).toMatch(/^문서 1쪽의/);
  });
});

describe("문장별 검증", () => {
  const HEX = "abcdef00-0000-4000-8000-00000000000a";
  const allowed = [{ chunk_id: uuid(1) }, { chunk_id: uuid(2) }, { chunk_id: HEX }];
  const contents = ["짧은 본문", "다른 본문"];

  it("거부된 ID는 빼고(중복 제거), 유효 인용 0건 문장·형식 위반은 버린다", () => {
    const raw = [
      { text: " 첫  문장 ", chunk_ids: [uuid(1), uuid(9), uuid(1)] },
      { text: "근거 없음", chunk_ids: [uuid(9)] },
      { text: "대문자", chunk_ids: [HEX.toUpperCase()] },
      { text: "", chunk_ids: [uuid(1)] },
      { text: "가".repeat(VIDEO_SUMMARY_SETTINGS.maxSentenceChars + 1), chunk_ids: [uuid(1)] },
      { text: "배열 아님", chunk_ids: uuid(1) },
      "문자열",
      { text: "둘째", chunk_ids: [uuid(2)] },
    ];
    expect(checkVideoSummary(raw, allowed, contents)).toEqual({
      sentences: [
        { text: "첫 문장", chunk_ids: [uuid(1)] },
        { text: "둘째", chunk_ids: [uuid(2)] },
      ],
      dropped: 6,
    });
  });

  it("남은 문장이 없거나 배열이 아니면 빈 결과(저장 안 함), 문장 수 상한을 넘으면 뒤를 버린다", () => {
    expect(checkVideoSummary([{ text: "x", chunk_ids: [uuid(9)] }], allowed, contents).sentences).toEqual([]);
    expect(checkVideoSummary({ sentences: [] }, allowed, contents)).toEqual({ sentences: [], dropped: 0 });
    const many = Array.from({ length: VIDEO_SUMMARY_SETTINGS.maxSentences + 3 }, (_, i) => ({ text: `문장 ${i}`, chunk_ids: [uuid(1)] }));
    const r = checkVideoSummary(many, allowed, contents);
    expect(r.sentences.length).toBe(VIDEO_SUMMARY_SETTINGS.maxSentences);
    expect(r.dropped).toBe(3);
  });

  it("청크 본문과 연속 100자 이상 같은 문장은 버리고 99자는 남긴다(연속 공백은 하나로)", () => {
    const body = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0xac00 + i)).join("");
    const long = body.slice(50, 150);
    const short = body.slice(50, 149);
    expect(quotesChunk(long, [body], 100)).toBe(true);
    expect(quotesChunk(short, [body], 100)).toBe(false);
    const r = checkVideoSummary(
      [
        { text: `요약: ${long}`, chunk_ids: [uuid(1)] },
        { text: `요약: ${short}`, chunk_ids: [uuid(1)] },
      ],
      allowed,
      [body],
    );
    expect(r.sentences.map((s) => s.text)).toEqual([`요약: ${short}`]);
    expect(r.dropped).toBe(1);
    // 줄바꿈·연속 공백은 공백 하나로 접어 비교한다
    const withBreaks = `${body.slice(0, 50)}\n\n  ${body.slice(50, 200)}`;
    expect(quotesChunk(`${body.slice(0, 50)} ${body.slice(50, 100)}`, [withBreaks], 100)).toBe(true);
  });

  it("제로폭·양방향 문자를 끼워 넣어도 100자 원문 인용으로 판정하고, 저장 문장에서도 지운다", () => {
    const body = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0xac00 + i)).join("");
    const long = body.slice(50, 150);
    const invisible = ["​", "‌", "‍", "⁠", "﻿", "‎", "‏", "؜", "‪", "‮", "⁦", "⁩"];
    // 10자마다 보이지 않는 문자를 끼워 넣어 연속 100자 일치를 깨려는 출력
    const evasive = Array.from(long).map((ch, i) => (i % 10 === 9 ? ch + invisible[Math.floor(i / 10) % invisible.length] : ch)).join("");
    expect(quotesChunk(evasive, [body], 100)).toBe(true);
    // 청크 본문 쪽에 들어 있어도 같다
    const evasiveBody = Array.from(body).map((ch, i) => (i % 7 === 0 ? `​${ch}` : ch)).join("");
    expect(quotesChunk(long, [evasiveBody], 100)).toBe(true);
    const r = checkVideoSummary(
      [
        { text: `요약: ${evasive}`, chunk_ids: [uuid(1)] },
        { text: "짧은​ 요‮약⁦", chunk_ids: [uuid(1)] },
      ],
      allowed,
      [body],
    );
    expect(r.sentences.map((s) => s.text)).toEqual(["짧은 요약"]);
    expect(r.dropped).toBe(1);
  });
});

function fakeStore(chunks: StoredChunk[], accept = true) {
  const saved: { jobId: string; sentences: SummarySentence[]; model: string }[] = [];
  const store: VideoSummaryStore = {
    loadChunks: async () => chunks,
    async save(jobId, sentences, model) {
      saved.push({ jobId, sentences, model });
      return accept;
    },
  };
  return { store, saved };
}

const source = { id: "s1", project_id: "p1", user_id: "u1" };

describe("runVideoSummaryStep", () => {
  it("스텁은 보낸 청크의 실제 chunk_id를 인용하고 처음·가운데·끝을 다룬다. 사용 기록·로그(본문 없음)", async () => {
    const chunks = chunksOf(50);
    const { store, saved } = fakeStore(chunks);
    const usage: UsageEvent[] = [];
    const logs: LogFields[] = [];
    const outcome = await runVideoSummaryStep(
      { provider: createStubVideoSummaryProvider(), store, recordUsage: async (e) => void usage.push(e), log: (f) => void logs.push(f) },
      "j1",
      source,
    );
    expect(outcome).toBe("saved");
    const ids = new Set(chunks.map((c) => c.chunk_id));
    const cited = saved[0]!.sentences.flatMap((s) => s.chunk_ids);
    expect(cited.length).toBe(3);
    for (const id of cited) expect(ids.has(id)).toBe(true);
    expect(cited[0]).toBe(uuid(0));
    expect(cited[2]).toBe(uuid(49));
    expect(saved[0]).toMatchObject({ jobId: "j1", model: "stub-video-summary-v1" });
    expect(usage).toEqual([expect.objectContaining({ eventType: "video_summary", provider: "stub", userId: "u1", projectId: "p1" })]);
    expect(logs).toContainEqual(expect.objectContaining({ event: "video_summary", outcome: "saved", sentences: 3, droppedSentences: 0 }));
    expect(JSON.stringify(logs)).not.toContain("전사");
  });

  it("보내지 않은 청크 인용은 거부된다(allowedChunks = 실제로 보낸 청크)", async () => {
    const chunks = chunksOf(100);
    const { store, saved } = fakeStore(chunks);
    let sent: string[] = [];
    const provider: VideoSummaryProvider = {
      name: "fake",
      model: "fake-1",
      async summarize(p) {
        sent = p.chunks.map((c) => c.chunk_id);
        const notSent = chunks.find((c) => !sent.includes(c.chunk_id))!.chunk_id;
        return { sentences: [{ text: "보내지 않은 청크", chunk_ids: [notSent] }, { text: "보낸 청크", chunk_ids: [sent[1], notSent] }] };
      },
    };
    expect(await runVideoSummaryStep({ provider, store, recordUsage: async () => {} }, "j1", source)).toBe("saved");
    expect(saved[0]!.sentences).toEqual([{ text: "보낸 청크", chunk_ids: [sent[1]] }]);
  });

  it("남은 문장이 없으면 저장하지 않고, 청크가 없으면 공급자를 부르지 않는다. 저장 거부는 rejected", async () => {
    const garbage: VideoSummaryProvider = { name: "g", model: "g", summarize: async () => ({ sentences: [{ text: "x", chunk_ids: [uuid(777)] }] }) };
    const a = fakeStore(chunksOf(3));
    expect(await runVideoSummaryStep({ provider: garbage, store: a.store, recordUsage: async () => {} }, "j1", source)).toBe("empty");
    expect(a.saved).toEqual([]);

    let called = false;
    const spy: VideoSummaryProvider = {
      name: "s",
      model: "s",
      summarize: async () => {
        called = true;
        return { sentences: [] };
      },
    };
    const b = fakeStore([{ chunk_id: uuid(1), content: "쪽", locator: { page: 1 } }]);
    expect(await runVideoSummaryStep({ provider: spy, store: b.store, recordUsage: async () => {} }, "j1", source)).toBe("no_chunks");
    expect(called).toBe(false);

    const c = fakeStore(chunksOf(3), false);
    expect(await runVideoSummaryStep({ provider: createStubVideoSummaryProvider(), store: c.store, recordUsage: async () => {} }, "j1", source)).toBe("rejected");
  });

  it("원문을 길게 옮긴 문장은 버린다(전부 버려지면 저장 안 함)", async () => {
    const body = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0xac00 + i)).join("");
    const chunks = [stored(0, body)];
    const copier: VideoSummaryProvider = {
      name: "c",
      model: "c",
      summarize: async (p) => ({ sentences: [{ text: body.slice(0, 120), chunk_ids: [p.chunks[0]!.chunk_id] }] }),
    };
    const { store, saved } = fakeStore(chunks);
    expect(await runVideoSummaryStep({ provider: copier, store, recordUsage: async () => {} }, "j1", source)).toBe("empty");
    expect(saved).toEqual([]);
  });
});
