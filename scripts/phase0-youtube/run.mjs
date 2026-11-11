// Gemini에 YouTube URL을 넘겨 전사 구간·장면 후보를 받아 responses/에 원본 저장한다(의존성 없음).
// 실행: node --env-file=apps/web/.env.local scripts/phase0-youtube/run.mjs [옵션] — 옵션은 README.md
// 전사·제목·응답 본문과 키는 stdout/stderr에 내지 않는다. 오류는 상태 코드와 고정 분류만 출력한다.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, HERE, KNOWN_ERRORS, PROMPT, PROMPT_SHA, SCHEMA, SCHEMA_SHA, appendLedger, labelPath, readLedger, resolveRoot, sha256 } from "./common.mjs";
import { classifyOffset, parseGeminiResponse, planChunks, validateVideos } from "./lib.mjs";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TEMPERATURE = 0;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 600_000;
const OFFSET_CLIP_SEC = 120;
const OFFSET_MIN_DURATION_SEC = 300;
const OFFSET_DIR = "_offset-check";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line) => process.stdout.write(`${line}\n`);
const complain = (line) => process.stderr.write(`${line}\n`);

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: "string", default: DEFAULT_MODEL },
      repeat: { type: "string", default: "1" },
      only: { type: "string" },
      "max-videos": { type: "string" },
      "offset-check": { type: "boolean", default: false },
      "chunk-sec": { type: "string", default: "1200" },
      "overlap-sec": { type: "string", default: "30" },
      "retry-delay-ms": { type: "string", default: "2000" },
      root: { type: "string", default: HERE },
    },
  });
  const int = (name, min) => {
    const n = Number(values[name]);
    if (!Number.isInteger(n) || n < min) throw new Error("bad_option");
    return n;
  };
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(values.model)) throw new Error("bad_option");
  return {
    model: values.model,
    repeat: int("repeat", 1),
    only: values.only ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null,
    maxVideos: values["max-videos"] === undefined ? null : int("max-videos", 1),
    offsetCheck: values["offset-check"],
    chunkSec: int("chunk-sec", 60),
    overlapSec: int("overlap-sec", 0),
    retryDelayMs: int("retry-delay-ms", 0),
    root: resolveRoot(values.root),
  };
}

function requestBody(url, chunk) {
  const video = { fileData: { fileUri: url } };
  if (chunk.clipped) video.videoMetadata = { startOffset: `${chunk.start}s`, endOffset: `${chunk.end}s` };
  return {
    contents: [{ role: "user", parts: [video, { text: PROMPT }] }],
    generationConfig: { temperature: TEMPERATURE, responseMimeType: "application/json", responseSchema: SCHEMA },
  };
}

function usageOf(raw) {
  const u = raw?.usageMetadata;
  if (!u) return null;
  return {
    input: u.promptTokenCount ?? 0,
    output: u.candidatesTokenCount ?? 0,
    thoughts: u.thoughtsTokenCount ?? 0,
    total: u.totalTokenCount ?? 0,
    prompt_details: u.promptTokensDetails ?? null,
  };
}

async function postOnce(endpoint, key, body) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: null, failure: "network_error", usage: null };
  }
  const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
  if (retryable) {
    const raw = await res.json().catch(() => null);
    return { status: res.status, failure: `http_${res.status}`, usage: usageOf(raw), retryable: true };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { status: res.status, failure: `http_${res.status}`, usage: null };
  }
  let raw;
  try {
    raw = await res.json();
  } catch {
    return { status: res.status, failure: "invalid_body", usage: null };
  }
  const parsed = parseGeminiResponse(raw);
  return { status: res.status, failure: parsed.ok ? null : parsed.failure, usage: usageOf(raw), raw, parsed };
}

async function callChunk(opts, key, url, chunk) {
  const endpoint = `${API_BASE}/${opts.model}:generateContent`;
  const attempts = [];
  let last;
  for (let n = 0; n <= MAX_RETRIES; n++) {
    if (n > 0) await sleep(opts.retryDelayMs * 2 ** (n - 1));
    last = await postOnce(endpoint, key, requestBody(url, chunk));
    attempts.push({
      n: n + 1,
      status: last.status,
      failure: last.failure,
      usage: last.usage,
      model_version: last.parsed?.modelVersion ?? null,
      finish_reason: last.parsed?.finishReason ?? null,
    });
    if (!last.retryable) break;
  }
  return { attempts, failure: last.failure, raw: last.raw ?? null, parsed: last.parsed?.ok ? last.parsed : null };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// 번호는 파일과 원장 중 큰 값 다음. 지운 실행 번호를 재사용하지 않는다.
function nextRunIndex(root, videoId, ledger) {
  const dir = join(root, "responses", videoId);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => /^run-\d+\.json$/.test(name)).map((name) => Number(name.slice(4, -5))) : [];
  const logged = ledger.filter((e) => e.video_id === videoId).map((e) => e.run_index);
  return Math.max(0, ...files, ...logged) + 1;
}

function countRunsToday(ledger) {
  const today = new Date().toISOString().slice(0, 10);
  return ledger.filter((e) => e.started_at?.slice(0, 10) === today).length;
}

function readOffsetVerdict(root, model) {
  const path = join(root, "output", "offset-check.json");
  if (!existsSync(path)) return null;
  const record = loadJson(path);
  if (record.model !== model || record.prompt_sha256 !== PROMPT_SHA) return null;
  return record.verdict === "absolute" || record.verdict === "relative" ? record.verdict : null;
}

async function runVideo(opts, key, video) {
  const chunks = planChunks(video.duration_sec, opts.chunkSec, opts.overlapSec);
  let timeBase = "not_clipped";
  if (chunks.length > 1) {
    timeBase = readOffsetVerdict(opts.root, opts.model);
    if (!timeBase) {
      say(`${video.id}: 건너뜀 분류=offset_check_required`);
      return false;
    }
  }
  const runIndex = nextRunIndex(opts.root, video.id, readLedger(opts.root));
  const record = {
    schema: 1,
    video_id: video.id,
    run_index: runIndex,
    started_at: new Date().toISOString(),
    finished_at: null,
    model_requested: opts.model,
    model_versions: [],
    temperature: TEMPERATURE,
    prompt_sha256: PROMPT_SHA,
    schema_sha256: SCHEMA_SHA,
    label_sha256: sha256(readFileSync(labelPath(opts.root, video.id))),
    chunk_sec: opts.chunkSec,
    overlap_sec: opts.overlapSec,
    time_base: timeBase,
    status: "ok",
    failure: null,
    chunks: [],
  };
  for (const chunk of chunks) {
    const result = await callChunk(opts, key, video.url, chunk);
    const versions = result.attempts.map((a) => a.model_version).filter(Boolean);
    record.model_versions = [...new Set([...record.model_versions, ...versions])];
    record.chunks.push({ ...chunk, attempts: result.attempts, failure: result.failure, raw: result.raw });
    if (result.failure) {
      record.status = "failed";
      record.failure = result.failure;
      break;
    }
  }
  record.finished_at = new Date().toISOString();
  const dir = join(opts.root, "responses", video.id);
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(record);
  writeFileSync(join(dir, `run-${String(runIndex).padStart(3, "0")}.json`), text);
  appendLedger(opts.root, {
    video_id: video.id,
    run_index: runIndex,
    status: record.status,
    failure: record.failure,
    started_at: record.started_at,
    model_requested: record.model_requested,
    prompt_sha256: record.prompt_sha256,
    label_sha256: record.label_sha256,
    file_sha256: sha256(text),
  });
  const attempts = record.chunks.reduce((acc, c) => acc + c.attempts.length, 0);
  const tokens = { input: 0, output: 0, thoughts: 0 };
  for (const c of record.chunks) {
    for (const a of c.attempts) for (const k of Object.keys(tokens)) tokens[k] += a.usage?.[k] ?? 0;
  }
  say(`${video.id} run-${runIndex}: ${record.status === "ok" ? "완료" : `실패 분류=${record.failure}`} 시도=${attempts} 입력=${tokens.input} 출력=${tokens.output} 사고=${tokens.thoughts}`);
  return record.status === "ok";
}

async function offsetCheck(opts, key, videos) {
  const video = videos.find((v) => v.duration_sec >= OFFSET_MIN_DURATION_SEC);
  if (!video) {
    complain(`--offset-check에는 길이 ${OFFSET_MIN_DURATION_SEC}초 이상 영상이 필요합니다.`);
    return 2;
  }
  const middle = Math.floor(video.duration_sec / 2);
  const start = Math.min(middle, video.duration_sec - OFFSET_CLIP_SEC);
  const control = { index: 0, start: 0, end: OFFSET_CLIP_SEC, clipped: true };
  const test = { index: 1, start, end: start + OFFSET_CLIP_SEC, clipped: true };
  const controlResult = await callChunk(opts, key, video.url, control);
  const testResult = controlResult.failure ? null : await callChunk(opts, key, video.url, test);
  const failure = controlResult.failure ?? testResult.failure;
  const verdict = failure ? "inconclusive" : classifyOffset(controlResult.parsed.segments, testResult.parsed.segments, test);
  const checkedAt = new Date().toISOString();
  const rawDir = join(opts.root, "responses", OFFSET_DIR);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `${checkedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify({ control: controlResult.raw, test: testResult?.raw ?? null }));
  const summarize = (r, clip) => ({
    clip,
    attempts: r?.attempts ?? [],
    t_start_min: r?.parsed?.segments.length ? Math.min(...r.parsed.segments.map((s) => s.t_start)) : null,
    t_start_max: r?.parsed?.segments.length ? Math.max(...r.parsed.segments.map((s) => s.t_start)) : null,
  });
  const outDir = join(opts.root, "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "offset-check.json"),
    JSON.stringify(
      {
        checked_at: checkedAt,
        model: opts.model,
        prompt_sha256: PROMPT_SHA,
        schema_sha256: SCHEMA_SHA,
        temperature: TEMPERATURE,
        video_id: video.id,
        verdict,
        failure,
        control: summarize(controlResult, control),
        test: summarize(testResult, test),
      },
      null,
      2,
    ),
  );
  say(`offset-check ${video.id}: 판정=${verdict}${failure ? ` 실패 분류=${failure}` : ""}`);
  return verdict === "inconclusive" ? 1 : 0;
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    complain("GEMINI_API_KEY 환경 변수가 필요합니다.");
    return 2;
  }
  const opts = readOptions(process.argv.slice(2));
  const videosPath = join(opts.root, "videos.json");
  if (!existsSync(videosPath)) {
    complain("videos.json이 없습니다. videos.example.json 형식으로 만드세요.");
    return 2;
  }
  const all = loadJson(videosPath);
  const errors = validateVideos(all);
  if (errors.length) {
    for (const e of errors) complain(`입력 거부: ${e}`);
    return 2;
  }
  const unknown = (opts.only ?? []).filter((id) => !all.some((v) => v.id === id));
  if (unknown.length) {
    complain(`입력 거부: --only에 없는 id ${unknown.length}건`);
    return 2;
  }
  const videos = opts.only ? all.filter((v) => opts.only.includes(v.id)) : all;
  if (opts.offsetCheck) return offsetCheck(opts, key, videos);

  // 정답 라벨을 먼저 고정해야 호출한다(측정 뒤 라벨 수정 방지).
  const unlabeled = videos.filter((v) => !existsSync(labelPath(opts.root, v.id)));
  if (unlabeled.length) {
    for (const v of unlabeled) complain(`입력 거부: ${v.id} label_missing`);
    return 2;
  }

  let budget = opts.maxVideos === null ? Infinity : opts.maxVideos - countRunsToday(readLedger(opts.root));
  let failed = false;
  for (const video of videos) {
    for (let i = 0; i < opts.repeat; i++) {
      if (budget <= 0) {
        say(`일 상한 도달: --max-videos ${opts.maxVideos}`);
        return failed ? 1 : 0;
      }
      budget--;
      if (!(await runVideo(opts, key, video))) failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    // 예외 메시지에 값이 섞일 수 있어 분류만 출력한다.
    const code = KNOWN_ERRORS.has(error?.message)
      ? error.message
      : error instanceof RangeError || error?.code?.startsWith?.("ERR_PARSE_ARGS")
        ? "bad_option"
        : error instanceof SyntaxError
          ? "invalid_json_file"
          : "internal_error";
    complain(`오류 분류=${code}`);
    process.exitCode = 2;
  }
}
