// run.mjs·measure.mjs를 실제 자식 프로세스로 돌려 키·전사 비노출을 증명한다. fetch는 --import로 대체하므로 외부 호출이 없다.
// --root는 이 폴더 아래만 허용되므로 임시 폴더를 무시 대상인 output/ 아래에 만든다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "run.mjs");
const MEASURE = join(HERE, "measure.mjs");
const KEY = "CANARY-KEY-do-not-leak-7f3a9c";
const SPOKEN = "카나리전사문장입니다";
const TITLE = "카나리장면제목";
const OUTPUT_DIR = join(HERE, "output");
const createdOutput = !existsSync(OUTPUT_DIR);
mkdirSync(OUTPUT_DIR, { recursive: true });
const base = mkdtempSync(join(OUTPUT_DIR, "test-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
  if (createdOutput && !readdirSync(OUTPUT_DIR).length) rmSync(OUTPUT_DIR, { recursive: true, force: true });
});

const MOCK = `
import { appendFileSync } from "node:fs";
const KEY_HEADER = "x-goog-api-key";
let calls = 0;
globalThis.fetch = async (url, init) => {
  calls += 1;
  const key = init.headers[KEY_HEADER];
  const body = JSON.parse(init.body);
  appendFileSync(process.env.MOCK_LOG, JSON.stringify({
    url: String(url),
    key_in_header: key === process.env.GEMINI_API_KEY,
    key_in_url: String(url).includes(key),
    key_in_body: init.body.includes(key),
    temperature: body.generationConfig.temperature,
    video: body.contents[0].parts[0],
  }) + "\\n");
  const mode = process.env.MOCK_MODE;
  if (mode === "throw") throw new Error("boom " + key + " ${SPOKEN}");
  if (mode === "echo400") return new Response(JSON.stringify({ error: { message: key + " ${SPOKEN}" } }), { status: 400 });
  if (mode === "always503") return new Response(JSON.stringify({ error: { message: key }, usageMetadata: { promptTokenCount: 7 } }), { status: 503 });
  if (mode === "flaky429" && calls === 1) return new Response("{}", { status: 429 });
  if (mode === "truncated") return new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }), { status: 200 });
  const clip = body.contents[0].parts[0].videoMetadata;
  const shift = clip && mode === "absolute" ? Number(clip.startOffset.slice(0, -1)) : 0;
  const payload = {
    segments: [{ t_start: 12 + shift, t_end: 15 + shift, text: "${SPOKEN}" }],
    scenes: [{ t: 12 + shift, title: "${TITLE}", description: "${TITLE}" }],
  };
  return new Response(JSON.stringify({
    modelVersion: "mock-version-1",
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 },
  }), { status: 200 });
};
`;
const mockPath = join(base, "mock-fetch.mjs");
writeFileSync(mockPath, MOCK);

const video = (over = {}) => ({
  id: "v1",
  url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
  language: "ko",
  rights_basis: "테스트용 권리 근거",
  duration_sec: 600,
  burned_in_subtitles: false,
  has_nonspeech: false,
  ...over,
});
const goodLabel = (id) => ({ video_id: id, fillers: "keep", eval_windows: [{ start: 0, end: 100 }], segments: [{ t_start: 10, t_end: 15, text: SPOKEN }], scenes: [{ t: 12 }] });

let counter = 0;
// labels: id → 라벨 객체. 기본은 모든 영상에 정상 라벨, null이면 그 영상 라벨을 만들지 않는다.
function setup(videos = [video()], labels = {}) {
  counter += 1;
  const root = join(base, `case-${counter}`);
  mkdirSync(join(root, "labels"), { recursive: true });
  writeFileSync(join(root, "videos.json"), JSON.stringify(videos));
  for (const v of videos) {
    const label = v.id in labels ? labels[v.id] : goodLabel(v.id);
    if (label) writeFileSync(join(root, "labels", `${v.id}.json`), JSON.stringify(label));
  }
  return root;
}

function run(root, args = [], { key = KEY, mode = "ok", script = RUN } = {}) {
  const log = join(base, `mock-${counter}.log`);
  rmSync(log, { force: true });
  const env = { ...process.env, MOCK_MODE: mode, MOCK_LOG: log };
  delete env.GEMINI_API_KEY;
  if (key) env.GEMINI_API_KEY = key;
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(mockPath).href, script, "--root", root, ...args], { encoding: "utf8", env });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { code: result.status, output: result.stdout + result.stderr, calls };
}

function allFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function assertNoLeak(root, output) {
  assert.ok(!output.includes(KEY), "키가 출력에 없어야 한다");
  assert.ok(!output.includes(SPOKEN), "전사가 출력에 없어야 한다");
  assert.ok(!output.includes(TITLE), "제목이 출력에 없어야 한다");
  for (const file of allFiles(root)) assert.ok(!readFileSync(file, "utf8").includes(KEY), `키가 파일에 없어야 한다: ${file}`);
}

const runPath = (root, id = "v1", n = 1) => join(root, "responses", id, `run-${String(n).padStart(3, "0")}.json`);
const runFile = (root, id = "v1", n = 1) => JSON.parse(readFileSync(runPath(root, id, n), "utf8"));
const ledger = (root) => readFileSync(join(root, "output", "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const metricsOf = (root) => JSON.parse(readFileSync(join(root, "output", "metrics.json"), "utf8"));
function measure(root, extra = []) {
  const doc = join(root, "doc.md");
  if (!existsSync(doc)) writeFileSync(doc, "앞 내용\n<!-- METRICS:BEGIN -->\n이전 표\n<!-- METRICS:END -->\n뒤 내용\n");
  return { ...run(root, ["--doc", doc, ...extra], { script: MEASURE }), doc };
}

test("키가 없으면 이름만 안내하고 호출 없이 종료", () => {
  const root = setup();
  const { code, output, calls } = run(root, [], { key: "" });
  assert.equal(code, 2);
  assert.match(output, /GEMINI_API_KEY/);
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(join(root, "responses")));
});

test("카나리 키: 성공 경로에서 헤더로만 전송하고 출력·저장에 없다", () => {
  const root = setup();
  const { code, output, calls } = run(root);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].key_in_header, calls[0].key_in_url, calls[0].key_in_body], [true, false, false]);
  assert.equal(calls[0].temperature, 0);
  assertNoLeak(root, output);
  const record = runFile(root);
  assert.equal(record.status, "ok");
  assert.equal(record.model_requested, "gemini-3.5-flash");
  assert.deepEqual(record.model_versions, ["mock-version-1"]);
  assert.match(record.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.match(record.schema_sha256, /^[0-9a-f]{64}$/);
  assert.match(record.label_sha256, /^[0-9a-f]{64}$/);
  const usage = record.chunks[0].attempts[0].usage;
  assert.deepEqual({ input: usage.input, output: usage.output, thoughts: usage.thoughts }, { input: 100, output: 20, thoughts: 5 });
  const [entry] = ledger(root);
  assert.deepEqual([entry.video_id, entry.run_index, entry.status, entry.label_sha256], ["v1", 1, "ok", record.label_sha256]);
});

test("카나리 키: API 오류 본문이 키·전사를 되돌려 줘도 비노출", () => {
  const root = setup();
  const { code, output, calls } = run(root, [], { mode: "echo400" });
  assert.equal(code, 1);
  assert.equal(calls.length, 1, "400은 재시도하지 않는다");
  assert.match(output, /http_400/);
  assertNoLeak(root, output);
});

test("카나리 키: 네트워크 예외 메시지도 비노출, 재시도 없음", () => {
  const root = setup();
  const { code, output, calls } = run(root, [], { mode: "throw" });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.match(output, /network_error/);
  assertNoLeak(root, output);
});

test("5xx는 최대 3회 재시도하고 재시도 토큰을 기록", () => {
  const root = setup();
  const { code, output, calls } = run(root, ["--retry-delay-ms", "1"], { mode: "always503" });
  assert.equal(code, 1);
  assert.equal(calls.length, 4);
  assertNoLeak(root, output);
  const record = runFile(root);
  assert.equal(record.failure, "http_503");
  assert.equal(record.chunks[0].attempts.reduce((acc, a) => acc + a.usage.input, 0), 28);
  assert.equal(ledger(root)[0].status, "failed");
});

test("429 뒤 성공하면 첫 유효 응답을 채택", () => {
  const root = setup();
  const { code, calls } = run(root, ["--retry-delay-ms", "1"], { mode: "flaky429" });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.equal(runFile(root).chunks[0].attempts.length, 2);
});

test("절단 응답은 재시도 없이 실패 처리", () => {
  const root = setup();
  const { code, output, calls } = run(root, [], { mode: "truncated" });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.match(output, /truncated/);
});

test("권리 근거 없는 목록은 호출 없이 거부", () => {
  const root = setup([video({ rights_basis: "" })]);
  const { code, output, calls } = run(root);
  assert.equal(code, 2);
  assert.match(output, /rights_basis:missing/);
  assert.equal(calls.length, 0);
});

test("라벨 파일이 없는 영상이 있으면 호출 없이 거부", () => {
  const root = setup([video(), video({ id: "v2" })], { v2: null });
  const { code, output, calls } = run(root);
  assert.equal(code, 2);
  assert.match(output, /v2 label_missing/);
  assert.equal(calls.length, 0);
});

test("--root가 이 폴더 밖이면 거부", () => {
  const outside = mkdtempSync(join(tmpdir(), "phase0-outside-"));
  try {
    writeFileSync(join(outside, "videos.json"), JSON.stringify([video()]));
    for (const script of [RUN, MEASURE]) {
      const { code, output, calls } = run(outside, [], { script });
      assert.equal(code, 2);
      assert.match(output, /bad_root/);
      assert.equal(calls.length, 0);
    }
    assert.match(run(join(HERE, ".."), []).output, /bad_root/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("--max-videos는 날짜 안에서 호출 상한으로 동작", () => {
  const root = setup([video(), video({ id: "v2" })]);
  assert.equal(run(root, ["--max-videos", "1"]).calls.length, 1);
  const second = run(root, ["--max-videos", "1"]);
  assert.equal(second.calls.length, 0);
  assert.match(second.output, /일 상한/);
});

test("--repeat은 실행 번호를 늘리고 덮어쓰지 않는다", () => {
  const root = setup();
  run(root, ["--repeat", "2"]);
  assert.equal(runFile(root, "v1", 1).run_index, 1);
  assert.equal(runFile(root, "v1", 2).run_index, 2);
  assert.deepEqual(ledger(root).map((e) => e.run_index), [1, 2]);
});

test("긴 영상은 오프셋 대조 전에는 호출하지 않는다", () => {
  const root = setup([video({ duration_sec: 3000 })]);
  const { code, output, calls } = run(root);
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(output, /offset_check_required/);
});

test("--offset-check 절대값 판정 뒤 분할 호출에 videoMetadata를 쓴다", () => {
  const root = setup([video({ duration_sec: 3000 })]);
  const check = run(root, ["--offset-check"], { mode: "absolute" });
  assert.equal(check.code, 0);
  assert.equal(check.calls.length, 2);
  assert.deepEqual(check.calls[1].video.videoMetadata, { startOffset: "1500s", endOffset: "1620s" });
  assert.equal(JSON.parse(readFileSync(join(root, "output", "offset-check.json"), "utf8")).verdict, "absolute");
  assertNoLeak(root, check.output);
  const { code, calls } = run(root, [], { mode: "absolute" });
  assert.equal(code, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].video.videoMetadata, { startOffset: "1170s", endOffset: "2370s" });
  assert.equal(runFile(root).time_base, "absolute");
});

test("measure: 수치 표만 갱신하고 전사·제목을 내보내지 않는다", () => {
  const invalid = { video_id: "v2", fillers: "keep", eval_windows: [] };
  const root = setup([video(), video({ id: "v2" }), video({ id: "v3" })], { v2: invalid, v3: null });
  run(root, ["--only", "v1,v2"]);
  const { code, output, doc } = measure(root);
  assert.equal(code, 0);
  assertNoLeak(root, output);
  const metrics = metricsOf(root);
  const adopted = metrics.videos.find((v) => v.id === "v1");
  assert.equal(adopted.status, "ok");
  assert.equal(adopted.cer.cer, 0);
  assert.equal(adopted.timing.within_tolerance, 1);
  assert.equal(adopted.cost.cost_usd, null);
  assert.equal(metrics.summary.invalid_labels, 1);
  assert.equal(metrics.summary.missing_labels, 1);
  assert.equal(metrics.summary.nonspeech.all.measurable, false);
  assert.equal(metrics.summary.long_video.status, "미검증");
  const metricsText = readFileSync(join(root, "output", "metrics.json"), "utf8");
  const text = readFileSync(doc, "utf8");
  for (const content of [metricsText, text]) {
    assert.ok(!content.includes(SPOKEN));
    assert.ok(!content.includes(TITLE));
  }
  assert.ok(text.startsWith("앞 내용"));
  assert.ok(text.trimEnd().endsWith("뒤 내용"));
  assert.ok(!text.includes("이전 표"));
  assert.match(text, /테스트용 권리 근거/);
  assert.match(text, /단가 미확인/);
  assert.match(text, /2시간 영상 상한: 미검증/);
});

test("measure: 실행 뒤 라벨이 바뀌면 label_changed로 측정 제외", () => {
  const root = setup();
  run(root);
  writeFileSync(join(root, "labels", "v1.json"), JSON.stringify({ ...goodLabel("v1"), segments: [{ t_start: 10, t_end: 15, text: "고친 정답" }] }));
  const { code, doc } = measure(root);
  assert.equal(code, 0);
  const metrics = metricsOf(root);
  assert.equal(metrics.videos[0].status, "label_changed");
  assert.equal(metrics.summary.changed_labels, 1);
  assert.match(readFileSync(doc, "utf8"), /label_changed/);
});

test("measure: 원장과 응답 파일이 어긋나면 거부", () => {
  const root = setup();
  run(root);
  appendFileSync(runPath(root), " ");
  const changed = measure(root);
  assert.equal(changed.code, 2);
  assert.match(changed.output, /v1#1:file_changed/);
  assert.match(changed.output, /ledger_mismatch/);
  assert.ok(!existsSync(join(root, "output", "metrics.json")));

  const root2 = setup();
  run(root2);
  writeFileSync(join(root2, "output", "ledger.jsonl"), "");
  const missing = measure(root2);
  assert.equal(missing.code, 2);
  assert.match(missing.output, /v1#1:missing_in_ledger/);
});

test("measure: 다른 모델 실행은 채택하지 않고, 비용은 실패·재시도 포함 모든 실행을 금액으로 합산", () => {
  const root = setup();
  writeFileSync(
    join(root, "pricing.json"),
    JSON.stringify({
      "gemini-3.5-flash": { input_per_1m_usd: 1, output_per_1m_usd: 2, thinking_per_1m_usd: 3, source_url: "https://example.test/pricing", checked_at: "2026-11-11" },
      "other-model": { input_per_1m_usd: 10, output_per_1m_usd: 10, thinking_per_1m_usd: 10, source_url: "https://example.test/pricing", checked_at: "2026-11-11" },
    }),
  );
  run(root, ["--model", "other-model"]);
  run(root, ["--retry-delay-ms", "1"], { mode: "always503" });
  run(root);
  const { code } = measure(root);
  assert.equal(code, 0);
  const metrics = metricsOf(root);
  const v = metrics.videos[0];
  assert.equal(v.adopted_run, 3);
  assert.equal(metrics.summary.excluded_other_condition_runs, 1);
  // other-model 1회(입력 100·출력 20·사고 5, 단가 10) + 503 4회(입력 28) + 성공 1회(100·20·5)
  const expected = (125 * 10 + 28 * 1 + (100 * 1 + 20 * 2 + 5 * 3)) / 1_000_000;
  assert.equal(v.cost.runs, 3);
  assert.equal(v.cost.tokens.input, 228);
  assert.ok(Math.abs(v.cost.cost_usd - expected) < 1e-12);
  assert.ok(Math.abs(metrics.summary.total_cost.cost_usd - expected) < 1e-12);
});

test("measure: 표식이 없는 문서는 덮어쓰지 않는다", () => {
  const root = setup();
  const doc = join(root, "doc.md");
  writeFileSync(doc, "표식 없음");
  const { code, output } = measure(root);
  assert.equal(code, 2);
  assert.match(output, /doc_markers_missing/);
  assert.equal(readFileSync(doc, "utf8"), "표식 없음");
});
