import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateCerByLanguage,
  aggregateTiming,
  alignSemiGlobal,
  cerOf,
  checkLedger,
  classifyOffset,
  costOfRuns,
  costUsd,
  dispersion,
  evaluateNonspeech,
  evaluateScenes,
  evaluateTranscript,
  extractVideoId,
  isNonspeechTagOnly,
  mergeChunks,
  normalizeText,
  parseGeminiResponse,
  planChunks,
  randomBaselineP,
  resolvePricing,
  selectAdoptedRun,
  sumNonspeech,
  tallyErrors,
  validateLabel,
  validateScenes,
  validateSegments,
  validateVideos,
} from "./lib.mjs";

const chars = (s) => Array.from(s);
const tally = (ref, hyp) => tallyErrors(alignSemiGlobal(chars(ref), chars(hyp)));
const baseLabel = (over = {}) => ({
  video_id: "v1",
  fillers: "keep",
  eval_windows: [{ start: 0, end: 100 }],
  segments: [{ t_start: 10, t_end: 15, text: "안녕하세요 여러분" }],
  ...over,
});
const baseVideo = (over = {}) => ({
  id: "v1",
  url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
  language: "ko",
  rights_basis: "본인 채널",
  duration_sec: 600,
  burned_in_subtitles: false,
  has_nonspeech: false,
  ...over,
});

test("정규화: NFKC·영문 소문자·공백·문장부호 제거", () => {
  assert.equal(normalizeText("Ａ B, 안녕!"), "ab안녕");
  assert.equal(normalizeText("１,０００원"), "1000원");
});

test("정규화: 간투사는 ignore일 때 단독 토큰만 제외", () => {
  assert.equal(normalizeText("어, 음 그 그래서 어머니", { ignoreFillers: true }), "그래서어머니");
  assert.equal(normalizeText("어, 음 그 그래서", { ignoreFillers: false }), "어음그그래서");
});

test("CER: 치환·삭제·삽입을 분리해 센다", () => {
  assert.deepEqual(tally("가나다라", "가바다라"), { substitutions: 1, deletions: 0, insertions: 0, ref_syllables: 4 });
  assert.deepEqual(tally("가나다라", "가다라"), { substitutions: 0, deletions: 1, insertions: 0, ref_syllables: 4 });
  assert.deepEqual(tally("가나다라", "가나바다라"), { substitutions: 0, deletions: 0, insertions: 1, ref_syllables: 4 });
  assert.equal(cerOf(tally("가나다라", "가바다")), 2 / 4);
});

const cerCounts = (r) => ({ s: r.cer.substitutions, d: r.cer.deletions, i: r.cer.insertions, n: r.cer.ref_syllables });

test("CER: 창 안에 시작한 전사 글자는 정렬 밖이어도 삽입", () => {
  const label = baseLabel({ eval_windows: [{ start: 100, end: 200 }], segments: [{ t_start: 120, t_end: 125, text: "가나다" }] });
  const result = evaluateTranscript(label, [{ t_start: 120, t_end: 125, text: "앞문장가나다뒷문장" }], 600);
  assert.deepEqual(cerCounts(result), { s: 0, d: 0, i: 6, n: 3 });
  assert.equal(result.cer.cer, 2);
});

test("CER 재현: 창 안 환각 구간 + 정답 구간 → 환각 글자 수만큼 삽입", () => {
  const label = baseLabel({ eval_windows: [{ start: 100, end: 200 }], segments: [{ t_start: 120, t_end: 125, text: "가나다" }] });
  const hyp = [
    { t_start: 110, t_end: 115, text: "환각문장" },
    { t_start: 120, t_end: 125, text: "가나다" },
  ];
  const result = evaluateTranscript(label, hyp, 600);
  assert.deepEqual(cerCounts(result), { s: 0, d: 0, i: 4, n: 3 });
  assert.equal(result.cer.cer, 4 / 3);
});

test("CER: 창 ±10초 밖 구간은 정렬에 쓰지 않고, 창 밖 여유 구간 글자는 삽입이 아님", () => {
  const label = baseLabel({ eval_windows: [{ start: 100, end: 200 }], segments: [{ t_start: 120, t_end: 125, text: "가나다" }] });
  const hyp = [
    { t_start: 50, t_end: 55, text: "가나다" },
    { t_start: 95, t_end: 99, text: "여유구간" },
    { t_start: 120, t_end: 125, text: "가나다" },
    { t_start: 300, t_end: 305, text: "멀리" },
  ];
  assert.deepEqual(cerCounts(evaluateTranscript(label, hyp, 600)), { s: 0, d: 0, i: 0, n: 3 });
  assert.deepEqual(cerCounts(evaluateTranscript(label, [{ t_start: 50, t_end: 55, text: "가나다" }], 600)), { s: 0, d: 3, i: 0, n: 3 });
});

test("CER: 정렬 함수 자체는 양끝 전사를 비용 없이 제외하고 범위를 돌려준다", () => {
  const alignment = alignSemiGlobal(chars("가나다"), chars("앞문장가나다뒷문장"));
  assert.deepEqual(tallyErrors(alignment), { substitutions: 0, deletions: 0, insertions: 0, ref_syllables: 3 });
  assert.deepEqual([alignment.hypStart, alignment.hypEnd], [3, 6]);
});

test("간투사만 있는 정답 문장은 평가 제외(분모 미포함)하고 건수 보고", () => {
  const label = baseLabel({
    fillers: "ignore",
    segments: [
      { t_start: 10, t_end: 12, text: "어, 음" },
      { t_start: 20, t_end: 25, text: "본문 문장" },
    ],
  });
  const { timing, cer } = evaluateTranscript(label, [{ t_start: 20, t_end: 25, text: "본문 문장" }], 600);
  assert.equal(timing.total, 1);
  assert.equal(timing.unaligned, 0);
  assert.equal(timing.excluded_empty, 1);
  assert.equal(cer.ref_syllables, 4);
  assert.equal(aggregateTiming([{ timing }]).excluded_empty, 1);
  assert.deepEqual(validateLabel(label, baseVideo()), []);
  assert.ok(validateLabel(baseLabel({ fillers: "ignore", segments: [{ t_start: 10, t_end: 12, text: "어, 음" }] }), baseVideo()).includes("segments:no_evaluable"));
});

test("숫자: 아라비아·한글 수사를 같은 값으로 보고 CER에서 제외", () => {
  const label = baseLabel({
    segments: [{ t_start: 10, t_end: 15, text: "매출은 2024년 3억" }],
    numbers: [
      { segment: 0, surface: "2024", forms: ["2024", "이천이십사"] },
      { segment: 0, surface: "3", forms: ["3", "삼"] },
    ],
  });
  const result = evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "매출은 이천이십사년 삼억" }], 600);
  assert.equal(result.numbers.matched, 2);
  assert.equal(result.numbers.rate, 1);
  assert.deepEqual(
    { s: result.cer.substitutions, d: result.cer.deletions, i: result.cer.insertions, n: result.cer.ref_syllables },
    { s: 0, d: 0, i: 0, n: 5 },
  );
});

test("숫자: 다른 값·자릿수 일부만 같은 값은 불일치", () => {
  const label = baseLabel({
    segments: [{ t_start: 10, t_end: 15, text: "매출은 3억" }],
    numbers: [{ segment: 0, surface: "3", forms: ["3", "삼"] }],
  });
  assert.equal(evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "매출은 30억" }], 600).numbers.matched, 0);
  assert.equal(evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "매출은 5억" }], 600).numbers.matched, 0);
});

test("숫자: 양쪽 기준점 사이가 길어도 기준점 근처만 본다", () => {
  const label = baseLabel({
    segments: [{ t_start: 10, t_end: 15, text: "매출은 3억 원이었습니다" }],
    numbers: [{ segment: 0, surface: "3", forms: ["3", "삼"] }],
  });
  const far = evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "매출은 가가가3가가가 억 원이었습니다" }], 600);
  assert.equal(far.numbers.matched, 0);
  const near = evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "매출은 가가가가3억 원이었습니다" }], 600);
  assert.equal(near.numbers.matched, 1);
});

test("고유명사: 표기·별칭 일치율은 별도, CER에는 포함", () => {
  const label = baseLabel({
    segments: [{ t_start: 10, t_end: 15, text: "노마드 팀이 발표" }],
    proper_nouns: [{ segment: 0, surface: "노마드", aliases: ["nomad"] }],
  });
  assert.equal(evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "노마드 팀이 발표" }], 600).proper_nouns.matched, 1);
  assert.equal(evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "NOMAD 팀이 발표" }], 600).proper_nouns.matched, 1);
  const wrong = evaluateTranscript(label, [{ t_start: 10, t_end: 15, text: "노만드 팀이 발표" }], 600);
  assert.equal(wrong.proper_nouns.matched, 0);
  assert.ok(wrong.cer.cer > 0);
});

test("정렬·시각: 글자 정렬 뒤 전사 구간 시작과 비교해 ±10초 판정", () => {
  const label = baseLabel({
    eval_windows: [{ start: 0, end: 600 }],
    segments: [
      { t_start: 100, t_end: 105, text: "오늘은 날씨가 맑습니다" },
      { t_start: 200, t_end: 205, text: "회의 안건을 정리했어요" },
      { t_start: 500, t_end: 505, text: "마지막으로 질문 받겠습니다" },
    ],
  });
  const hyp = [
    { t_start: 105, t_end: 110, text: "오늘은 날씨가 맑습니다" },
    { t_start: 215, t_end: 220, text: "회의 안건을 정리했어요" },
  ];
  const { timing } = evaluateTranscript(label, hyp, 600);
  assert.equal(timing.total, 3);
  assert.equal(timing.within_tolerance, 1);
  assert.equal(timing.unaligned, 1);
  assert.deepEqual(timing.quartile_errors[0], [5]);
  assert.deepEqual(timing.quartile_errors[1], [15]);
  assert.equal(timing.quartile_hits[0], 1);
});

test("시각: 무작위 기준선과 유의성", () => {
  assert.equal(randomBaselineP(300, 600), 20 / 600);
  assert.equal(randomBaselineP(0, 600), 10 / 600);
  const hit = { total: 100, within_tolerance: 90, unaligned: 0, baseline_sum: 3, baseline_var: 2.9, quartile_errors: [[1], [], [], []], quartile_hits: [1, 0, 0, 0] };
  const agg = aggregateTiming([{ timing: hit }]);
  assert.equal(agg.rate, 0.9);
  assert.equal(agg.random_baseline, 0.03);
  assert.equal(agg.significant, true);
  assert.equal(agg.quartiles[0].mean_error_sec, 1);
  const chance = aggregateTiming([{ timing: { ...hit, within_tolerance: 3, quartile_hits: [0, 0, 0, 0] } }]);
  assert.equal(chance.significant, false);
});

test("비발화: 허용오차 안팎·태그·가사 분류", () => {
  const label = {
    nonspeech: [
      { start: 100, end: 200, kind: "music" },
      { start: 300, end: 360, kind: "lyrics" },
    ],
  };
  const hyp = [
    { t_start: 95, t_end: 105, text: "경계 발화" },
    { t_start: 150, t_end: 155, text: "허위 문장" },
    { t_start: 160, t_end: 170, text: "[음악]" },
    { t_start: 320, t_end: 325, text: "노래 가사" },
    { t_start: 400, t_end: 405, text: "범위 밖 발화" },
  ];
  assert.deepEqual(evaluateNonspeech(label, hyp), {
    intervals: 2,
    outside_tolerance: 1,
    within_tolerance: 1,
    tags: 1,
    lyrics: 1,
    inner_minutes: 80 / 60,
    band_minutes: 20 / 60,
  });
  assert.equal(isNonspeechTagOnly("[music]"), true);
  assert.equal(isNonspeechTagOnly("[음악] 안녕"), false);
});

test("비발화: 측정 구간이 없으면 0건 통과가 아니라 측정 불가", () => {
  const none = sumNonspeech([evaluateNonspeech({ nonspeech: [] }, [])]);
  assert.equal(none.measurable, false);
  assert.equal(none.outside_per_minute, null);
  const shortOnly = sumNonspeech([evaluateNonspeech({ nonspeech: [{ start: 0, end: 15, kind: "silence" }] }, [{ t_start: 5, t_end: 8, text: "말" }])]);
  assert.equal(shortOnly.measurable, false);
  assert.equal(shortOnly.within_tolerance, 1);
  const zero = sumNonspeech([evaluateNonspeech({ nonspeech: [{ start: 0, end: 120, kind: "silence" }] }, [])]);
  assert.equal(zero.measurable, true);
  assert.equal(zero.outside_per_minute, 0);
});

test("장면 겹침은 평가 창 안에서만 센다", () => {
  const label = baseLabel({ scenes: [{ t: 50 }, { t: 90 }, { t: 500 }] });
  assert.deepEqual(evaluateScenes(label, [{ t: 55 }, { t: 70 }, { t: 505 }]), { human_total: 2, human_covered: 1, model_total: 2, model_near_human: 1 });
});

test("입력 검증: 권리 근거 없으면 거부", () => {
  assert.deepEqual(validateVideos([baseVideo()]), []);
  assert.ok(validateVideos([baseVideo({ rights_basis: "  " })]).includes("videos[0].rights_basis:missing"));
  const noRights = baseVideo();
  delete noRights.rights_basis;
  assert.ok(validateVideos([noRights]).includes("videos[0].rights_basis:missing"));
});

test("입력 검증: 허용 호스트의 공개 영상 URL만", () => {
  for (const url of ["https://youtube.com/watch?v=AAAAAAAAAAA", "https://www.youtube.com/watch?v=AAAAAAAAAAA&t=3", "https://m.youtube.com/watch?v=AAAAAAAAAAA", "https://youtu.be/AAAAAAAAAAA"]) assert.equal(extractVideoId(url), "AAAAAAAAAAA", url);
  for (const url of ["http://www.youtube.com/watch?v=AAAAAAAAAAA", "https://youtube.com.evil.test/watch?v=AAAAAAAAAAA", "https://evil.test/youtu.be/AAAAAAAAAAA", "https://user:pw@youtu.be/AAAAAAAAAAA", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/watch?v=short", "not a url"]) assert.equal(extractVideoId(url), null, url);
});

test("입력 검증: 오류에 값을 싣지 않고 id 중복·경로 문자 거부", () => {
  const errors = validateVideos([baseVideo({ url: "https://evil.test/SECRETVALUE" }), baseVideo({ id: "../x" }), baseVideo()]);
  assert.ok(errors.some((e) => e.endsWith(".url:not_public_youtube")));
  assert.ok(errors.includes("videos[1].id:invalid"));
  assert.ok(!errors.join().includes("SECRETVALUE"));
  assert.ok(validateVideos([baseVideo(), baseVideo()]).includes("videos[1].id:duplicate"));
});

test("라벨 검증: 평가 창·긴 영상 전체 라벨 금지·표기 위치", () => {
  assert.deepEqual(validateLabel(baseLabel(), baseVideo()), []);
  assert.ok(validateLabel(baseLabel({ eval_windows: [] }), baseVideo()).includes("eval_windows:missing"));
  const longVideo = baseVideo({ duration_sec: 3000 });
  assert.ok(validateLabel(baseLabel({ eval_windows: [{ start: 0, end: 3000 }] }), longVideo).includes("eval_windows:whole_long_video_labeled"));
  assert.ok(validateLabel(baseLabel({ segments: [{ t_start: 200, t_end: 205, text: "창 밖" }] }), baseVideo()).includes("segments[0]:outside_eval_windows"));
  assert.ok(validateLabel(baseLabel({ numbers: [{ segment: 0, surface: "없는말", forms: ["1"] }] }), baseVideo()).includes("mentions:surface_not_found"));
  assert.ok(validateLabel(baseLabel({ nonspeech: [{ start: 1, end: 2, kind: "music" }] }), baseVideo()).includes("nonspeech:has_nonspeech_mismatch"));
  assert.ok(validateLabel(baseLabel(), baseVideo({ has_nonspeech: true })).includes("nonspeech:has_nonspeech_mismatch"));
});

test("시각 검증: 범위·역전·순서·겹침을 버리고 집계", () => {
  const { kept, rejected } = validateSegments(
    [
      { t_start: 0, t_end: 5, text: "a" },
      { t_start: 3, t_end: 6, text: "겹침" },
      { t_start: 10, t_end: 8, text: "역전" },
      { t_start: 600, t_end: 601, text: "범위 밖" },
      { t_start: 20, t_end: 25, text: "b" },
      { t_start: 12, t_end: 13, text: "순서" },
      { t_start: Number.NaN, t_end: 1, text: "비수치" },
    ],
    600,
  );
  assert.deepEqual(kept.map((s) => s.text), ["a", "b"]);
  assert.deepEqual(rejected, { non_finite: 1, out_of_range: 1, reversed: 1, out_of_order: 1, overlap: 1, duplicate: 0 });
  assert.equal(validateScenes([{ t: 1 }, { t: 1 }, { t: 700 }], 600).kept.length, 1);
});

test("분할: 기본 20분·겹침 30초", () => {
  assert.deepEqual(planChunks(600), [{ index: 0, start: 0, end: 600, clipped: false }]);
  const chunks = planChunks(3000);
  assert.deepEqual(chunks.map((c) => [c.start, c.end]), [[0, 1200], [1170, 2370], [2340, 3000]]);
  assert.throws(() => planChunks(100, 30, 30));
});

test("분할 병합: 상대 시각 변환·겹침 정리·범위 밖 집계", () => {
  const chunks = planChunks(2000, 1200, 30);
  const parsedA = { segments: [{ t_start: 1180, t_end: 1185, text: "경계 전 절반" }, { t_start: 1190, t_end: 1195, text: "다음 조각이 맡음" }], scenes: [] };
  const parsedB = { segments: [{ t_start: 10, t_end: 15, text: "앞 조각이 맡음" }, { t_start: 20, t_end: 25, text: "경계 뒤" }, { t_start: 900, t_end: 905, text: "조각 밖" }], scenes: [] };
  const merged = mergeChunks([{ chunk: chunks[0], parsed: parsedA }, { chunk: chunks[1], parsed: parsedB }], "relative", 2000, 30);
  assert.deepEqual(merged.segments.map((s) => s.t_start), [1180, 1190]);
  assert.equal(merged.rejected.overlap_trimmed, 2);
  assert.equal(merged.rejected.outside_chunk, 1);
});

test("오프셋 대조: 절대·상대·불명 판정", () => {
  const clip = { start: 300, end: 420 };
  const control = [{ t_start: 5 }, { t_start: 90 }];
  assert.equal(classifyOffset(control, [{ t_start: 310 }, { t_start: 400 }], clip), "absolute");
  assert.equal(classifyOffset(control, [{ t_start: 10 }, { t_start: 100 }], clip), "relative");
  assert.equal(classifyOffset(control, [{ t_start: 200 }, { t_start: 900 }], clip), "inconclusive");
  assert.equal(classifyOffset([{ t_start: 500 }], [{ t_start: 310 }], clip), "inconclusive");
  assert.equal(classifyOffset([], [], clip), "inconclusive");
});

test("응답 해석: 절단·차단·JSON 오류는 실패", () => {
  const body = (finishReason, text) => ({ modelVersion: "m-1", candidates: [{ finishReason, content: { parts: [{ text }] } }] });
  const good = JSON.stringify({ segments: [{ t_start: 0, t_end: 1, text: "a", extra: "x" }], scenes: [] });
  const ok = parseGeminiResponse(body("STOP", good));
  assert.equal(ok.ok, true);
  assert.equal(ok.modelVersion, "m-1");
  assert.deepEqual(Object.keys(ok.segments[0]), ["t_start", "t_end", "text"]);
  assert.equal(parseGeminiResponse(body("MAX_TOKENS", good)).failure, "truncated");
  assert.equal(parseGeminiResponse(body("SAFETY", good)).failure, "blocked");
  assert.equal(parseGeminiResponse(body("STOP", "{ 잘림")).failure, "invalid_json");
  assert.equal(parseGeminiResponse(body("STOP", '{"segments":[{"t_start":"0:01"}],"scenes":[]}')).failure, "schema_mismatch");
  assert.equal(parseGeminiResponse({ promptFeedback: { blockReason: "OTHER" } }).failure, "blocked");
  assert.equal(parseGeminiResponse({}).failure, "no_candidate");
});

test("첫 유효 실행만 채택, 현재 모델·프롬프트 조건만 대상", () => {
  const cond = { model: "m", promptSha: "p" };
  const r = (run_index, status, model_requested = "m", prompt_sha256 = "p") => ({ run_index, status, model_requested, prompt_sha256 });
  assert.equal(selectAdoptedRun([r(3, "ok"), r(1, "failed"), r(2, "ok")], cond).run_index, 2);
  assert.equal(selectAdoptedRun([r(1, "failed")], cond), null);
  assert.equal(selectAdoptedRun([r(1, "ok", "other"), r(2, "ok", "m", "old"), r(3, "ok")], cond).run_index, 3);
});

test("원장 대조: 누락·추가·상태·파일 변경·중복을 잡는다", () => {
  const e = (video_id, run_index, status = "ok", file_sha256 = "h") => ({ video_id, run_index, status, file_sha256 });
  assert.deepEqual(checkLedger([e("v", 1), e("v", 2, "failed")], [e("v", 1), e("v", 2, "failed")]), []);
  assert.deepEqual(checkLedger([e("v", 1)], [e("v", 1), e("v", 2)]), ["v#2:missing_in_ledger"]);
  assert.deepEqual(checkLedger([e("v", 1), e("v", 2)], [e("v", 1)]), ["v#2:missing_file"]);
  assert.deepEqual(checkLedger([e("v", 1, "failed")], [e("v", 1)]), ["v#1:status_mismatch"]);
  assert.deepEqual(checkLedger([e("v", 1)], [e("v", 1, "ok", "x")]), ["v#1:file_changed"]);
  assert.deepEqual(checkLedger([e("v", 1), e("v", 1)], [e("v", 1)]), ["v#1:duplicate_entry"]);
});

test("비용: 영상의 모든 실행(실패·재시도 포함)을 실행별 단가로 합산", () => {
  const entry = { input_per_1m_usd: 1, output_per_1m_usd: 2, thinking_per_1m_usd: 3, source_url: "https://example.test", checked_at: "2026-11-11" };
  const run = (model, usages) => ({ model_requested: model, chunks: [{ attempts: usages.map((usage) => ({ usage })) }] });
  const u = (input, output = 0, thoughts = 0) => ({ input, output, thoughts, total: input + output + thoughts });
  const runs = [run("m", [u(1_000_000), u(1_000_000)]), run("m", [null, u(0, 1_000_000, 1_000_000)])];
  const result = costOfRuns(runs, { m: entry });
  assert.equal(result.cost_usd, 7);
  assert.equal(result.tokens.input, 2_000_000);
  assert.equal(result.unpriced_runs, 0);
  const mixed = costOfRuns([...runs, run("unknown", [u(5)])], { m: entry });
  assert.equal(mixed.cost_usd, null);
  assert.equal(mixed.unpriced_runs, 1);
  assert.equal(mixed.tokens.input, 2_000_005);
});

test("비용: 출처·확인일 없는 단가는 미확인", () => {
  const entry = { input_per_1m_usd: 1, output_per_1m_usd: 2, thinking_per_1m_usd: 3, source_url: "https://example.test", checked_at: "2026-11-11" };
  assert.equal(costUsd({ input: 1_000_000, output: 1_000_000, thoughts: 1_000_000 }, resolvePricing({ m: entry }, "m")), 6);
  assert.equal(resolvePricing({ m: { ...entry, checked_at: "" } }, "m"), null);
  assert.equal(resolvePricing(null, "m"), null);
  assert.equal(costUsd({ input: 1, output: 1, thoughts: 1 }, null), null);
});

test("집계: 언어별 평균·최악, 반복 분산", () => {
  const v = (id, language, cer) => ({ id, language, cer: { cer } });
  const agg = aggregateCerByLanguage([v("a", "ko", 0.1), v("b", "ko", 0.3), v("c", "en", 0.2), v("d", "en", null)]);
  assert.equal(agg.ko.worst_video, "b");
  assert.ok(Math.abs(agg.ko.mean_cer - 0.2) < 1e-9);
  assert.equal(agg.en.videos, 1);
  assert.equal(dispersion([0.1]), null);
  assert.equal(dispersion([0.1, 0.3]).runs, 2);
});
