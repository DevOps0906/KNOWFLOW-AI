// 라벨과 원응답을 비교해 output/metrics.json과 결과 문서의 수치 표를 갱신한다. 전사 본문은 어디에도 내보내지 않는다.
// 실행: node scripts/phase0-youtube/measure.mjs [--model <id>] [--root <이 폴더 아래>] [--doc <결과 문서>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, HERE, KNOWN_ERRORS, PROMPT_SHA, labelPath, readLedger, resolveRoot, sha256 } from "./common.mjs";
import {
  TWO_HOURS_SEC,
  aggregateCerByLanguage,
  aggregateTiming,
  checkLedger,
  costOfRuns,
  dispersion,
  eligibleRuns,
  evaluateNonspeech,
  evaluateScenes,
  evaluateTranscript,
  mergeChunks,
  parseGeminiResponse,
  poolRate,
  resolvePricing,
  selectAdoptedRun,
  sumNonspeech,
  sumRunTokens,
  validateLabel,
  validateVideos,
} from "./lib.mjs";

const BEGIN = "<!-- METRICS:BEGIN -->";
const END = "<!-- METRICS:END -->";
const UNMEASURED = "측정 불가";

const say = (line) => process.stdout.write(`${line}\n`);
const complain = (line) => process.stderr.write(`${line}\n`);
const loadJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// 응답 폴더 전체를 읽는다. 원장 대조용 파일 해시를 함께 돌려준다.
function loadAllRuns(root) {
  const base = join(root, "responses");
  const byVideo = new Map();
  if (!existsSync(base)) return byVideo;
  for (const videoId of readdirSync(base)) {
    if (videoId.startsWith("_")) continue;
    const dir = join(base, videoId);
    const runs = readdirSync(dir)
      .filter((name) => /^run-\d+\.json$/.test(name))
      .map((name) => {
        const text = readFileSync(join(dir, name), "utf8");
        return { ...JSON.parse(text), file_sha256: sha256(text) };
      });
    byVideo.set(videoId, runs);
  }
  return byVideo;
}

function assemble(run, video) {
  const chunkResults = run.chunks.map((c) => ({ chunk: c, parsed: parseGeminiResponse(c.raw) }));
  return mergeChunks(chunkResults, run.time_base, video.duration_sec, run.overlap_sec);
}

function evaluateRun(run, video, label) {
  const merged = assemble(run, video);
  return {
    ...evaluateTranscript(label, merged.segments, video.duration_sec),
    nonspeech: evaluateNonspeech(label, merged.segments),
    scenes: evaluateScenes(label, merged.scenes),
    rejected: merged.rejected,
  };
}

function evaluateVideo(base, video, label, labelSha, runs, condition) {
  const eligible = eligibleRuns(runs, condition);
  const result = { ...base, eligible_runs: eligible.length, failures: runs.filter((r) => r.status !== "ok").map((r) => r.failure) };
  if (eligible.some((r) => r.label_sha256 !== labelSha)) return { ...result, status: "label_changed" };
  const adopted = selectAdoptedRun(runs, condition);
  if (!adopted) return { ...result, status: "no_valid_run" };
  const metrics = evaluateRun(adopted, video, label);
  const repeats = eligible.filter((r) => r.status === "ok").sort((a, b) => a.run_index - b.run_index);
  const cerByRun = repeats.map((r) => evaluateRun(r, video, label).cer.cer).filter((x) => x !== null);
  return {
    ...result,
    status: "ok",
    adopted_run: adopted.run_index,
    model: adopted.model_requested,
    model_versions: adopted.model_versions,
    started_at: adopted.started_at,
    prompt_sha256: adopted.prompt_sha256,
    schema_sha256: adopted.schema_sha256,
    temperature: adopted.temperature,
    attempts: adopted.chunks.reduce((acc, c) => acc + c.attempts.length, 0),
    chunks: adopted.chunks.length,
    adopted_tokens: sumRunTokens(adopted),
    cer_dispersion: dispersion(cerByRun),
    ...metrics,
  };
}

function longVideoStatus(evaluated, allRuns) {
  const long = evaluated.filter((v) => v.duration_sec >= TWO_HOURS_SEC && v.runs > 0);
  if (!long.length) return { status: "미검증", videos: 0 };
  const failures = long.flatMap((v) => (allRuns.get(v.id) ?? []).filter((r) => r.status !== "ok").map((r) => r.failure));
  return {
    status: failures.length ? "상한 또는 호출 실패 관찰" : "실패 없음",
    videos: long.length,
    failures,
    tokens: long.filter((v) => v.adopted_tokens).map((v) => ({ id: v.id, ...v.adopted_tokens })),
  };
}

function sumRejections(list) {
  const total = { segments: {}, scenes: {}, outside_chunk: 0, overlap_trimmed: 0 };
  for (const v of list) {
    for (const part of ["segments", "scenes"]) {
      for (const [k, n] of Object.entries(v.rejected[part])) total[part][k] = (total[part][k] ?? 0) + n;
    }
    total.outside_chunk += v.rejected.outside_chunk;
    total.overlap_trimmed += v.rejected.overlap_trimmed;
  }
  return total;
}

const pct = (x, digits = 2) => (x === null || x === undefined ? UNMEASURED : `${(x * 100).toFixed(digits)}%`);
const num = (x, digits = 2) => (x === null || x === undefined ? UNMEASURED : x.toFixed(digits));
const usd = (x) => (x === null ? "단가 미확인" : x.toFixed(4));
const cell = (text) => String(text).replace(/[|\r\n]+/g, " ");
const rejectedCount = (r) => Object.values(r.segments).reduce((a, b) => a + b, 0) + Object.values(r.scenes).reduce((a, b) => a + b, 0) + r.outside_chunk;

function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
}

function renderNonspeech(name, n) {
  return [
    name,
    n.videos,
    n.outside_tolerance,
    n.measurable ? num(n.outside_per_minute, 3) : UNMEASURED,
    n.within_tolerance,
    n.within_per_minute === null ? UNMEASURED : num(n.within_per_minute, 3),
    n.tags,
    n.lyrics,
    num(n.inner_minutes, 2),
  ];
}

function renderDoc(metrics) {
  const { videos, summary } = metrics;
  const ok = videos.filter((v) => v.status === "ok");
  const withRuns = videos.filter((v) => v.cost.runs > 0);
  const lines = [
    `> ${metrics.generated_at} 측정. 아래 수치는 **표에 적힌 모델·날짜 한정**이다. 합격 여부는 자동 판정하지 않는다.`,
    "",
    "### 실행 조건",
    table(
      ["항목", "값"],
      [
        ["측정 대상 조건", `모델 ${summary.condition.model} · 프롬프트 ${summary.condition.prompt_sha256}`],
        ["조건이 달라 제외한 실행", summary.excluded_other_condition_runs],
        ["응답 modelVersion", summary.conditions.model_versions.join(", ") || UNMEASURED],
        ["실행 날짜(UTC)", summary.conditions.dates.join(", ") || UNMEASURED],
        ["스키마 SHA-256", summary.conditions.schema_sha256.join(", ") || UNMEASURED],
        ["온도", summary.conditions.temperatures.join(", ") || UNMEASURED],
        ["분할 시각 기준(--offset-check)", summary.offset_check ? `${summary.offset_check.verdict} (${summary.offset_check.model}, ${summary.offset_check.checked_at})` : "미실행"],
      ],
    ),
    "",
    "### 영상별 (수치·권리 근거만)",
    table(
      ["영상", "언어", "권리 근거", "번인 자막", "길이(초)", "상태", "CER", "치환", "삭제", "삽입", "정답 음절", "숫자", "고유명사", "시각 ±10초", "비발화 밖", "비발화 안", "태그", "lyrics", "시도", "탈락"],
      videos.map((v) =>
        v.status === "ok"
          ? [v.id, v.language, v.rights_basis, v.burned_in_subtitles ? "있음" : "없음", v.duration_sec, "측정", pct(v.cer.cer), v.cer.substitutions, v.cer.deletions, v.cer.insertions, v.cer.ref_syllables, pct(v.numbers.rate), pct(v.proper_nouns.rate), pct(v.timing.rate), v.nonspeech.outside_tolerance, v.nonspeech.within_tolerance, v.nonspeech.tags, v.nonspeech.lyrics, v.attempts, rejectedCount(v.rejected)]
          : [v.id, v.language, v.rights_basis, v.burned_in_subtitles ? "있음" : "없음", v.duration_sec, v.status, ...Array(14).fill(UNMEASURED)],
      ),
    ),
    "",
    "### 언어별 CER",
    Object.keys(summary.cer_by_language).length
      ? table(
          ["언어", "영상 수", "평균 CER", "최악 CER", "최악 영상"],
          Object.entries(summary.cer_by_language).map(([lang, c]) => [lang, c.videos, pct(c.mean_cer), pct(c.worst_cer), c.worst_video]),
        )
      : UNMEASURED,
    "",
    `숫자 일치: ${pct(summary.numbers.rate)} (${summary.numbers.matched}/${summary.numbers.total}) · 고유명사 일치: ${pct(summary.proper_nouns.rate)} (${summary.proper_nouns.matched}/${summary.proper_nouns.total})`,
    "",
    "### 시각 (±10초)",
    `일치율 ${pct(summary.timing.rate)} (${summary.timing.within_tolerance}/${summary.timing.total}, 정렬 실패 ${summary.timing.unaligned}, 빈 정답 문장 제외 ${summary.timing.excluded_empty}) · 무작위 기준선 ${pct(summary.timing.random_baseline)} · z ${num(summary.timing.z)} · 유의 ${summary.timing.significant === null ? UNMEASURED : summary.timing.significant ? "예" : "아니오"}`,
    "",
    table(
      ["영상 위치", "정렬 문장", "평균 오차(초)", "중앙 오차(초)", "±10초 일치"],
      summary.timing.quartiles.map((q) => [`Q${q.quartile}`, q.aligned, num(q.mean_error_sec), num(q.median_error_sec), pct(q.hit_rate)]),
    ),
    "",
    "### 비발화 구간 (번인 자막 층화)",
    table(
      ["층", "영상 수", "허용오차 밖 건수", "밖 분당", "허용오차 안 건수", "안 분당", "태그", "lyrics", "분모(분)"],
      [renderNonspeech("전체", summary.nonspeech.all), renderNonspeech("번인 자막 있음", summary.nonspeech.burned_in), renderNonspeech("번인 자막 없음", summary.nonspeech.no_burned_in)],
    ),
    "",
    "### 장면 겹침 (참고값, 판정 미사용)",
    `사람 장면 중 ±10초 내 모델 장면 있음 ${summary.scenes.human_covered}/${summary.scenes.human_total} · 모델 장면 중 사람 장면 근처 ${summary.scenes.model_near_human}/${summary.scenes.model_total}`,
    "",
    "### 비용 (영상의 모든 실행·재시도 합산)",
    table(
      ["영상", "실행 수", "입력 토큰", "출력 토큰", "사고 토큰", "비용(USD)", "단가 미확인 실행"],
      withRuns.map((v) => [v.id, v.cost.runs, v.cost.tokens.input, v.cost.tokens.output, v.cost.tokens.thoughts, usd(v.cost.cost_usd), v.cost.unpriced_runs]),
    ),
    "",
    `전체 합계: 실행 ${summary.total_cost.runs} · 입력 ${summary.total_cost.tokens.input} · 출력 ${summary.total_cost.tokens.output} · 사고 ${summary.total_cost.tokens.thoughts} · 비용(USD) ${usd(summary.total_cost.cost_usd)}`,
    "",
    `단가 출처: ${summary.pricing_sources.length ? summary.pricing_sources.map((p) => `${p.model} ${p.source_url} (${p.checked_at})`).join(", ") : "단가 미확인"}`,
    "",
    `2시간 영상 상한: ${summary.long_video.status}${summary.long_video.videos ? ` (${summary.long_video.videos}편)` : ""}`,
    "",
    "### 실패·탈락",
    `실패 실행 분류: ${JSON.stringify(summary.failures)} · 라벨 없음 ${summary.missing_labels}편 · 라벨 오류 ${summary.invalid_labels}편 · 라벨 변경 ${summary.changed_labels}편`,
    "",
    `시각 검증 탈락(구간): ${JSON.stringify(summary.rejected.segments)} · 탈락(장면): ${JSON.stringify(summary.rejected.scenes)} · 분할 범위 밖 ${summary.rejected.outside_chunk} · 겹침 정리 ${summary.rejected.overlap_trimmed}`,
    "",
    "### 반복 실행 분산 (CER)",
    ok.some((v) => v.cer_dispersion)
      ? table(
          ["영상", "유효 실행", "평균", "표준편차", "최소", "최대"],
          ok.filter((v) => v.cer_dispersion).map((v) => [v.id, v.cer_dispersion.runs, pct(v.cer_dispersion.mean), pct(v.cer_dispersion.stdev), pct(v.cer_dispersion.min), pct(v.cer_dispersion.max)]),
        )
      : "반복 실행 없음",
  ];
  return lines.join("\n");
}

function updateDoc(path, body) {
  const doc = readFileSync(path, "utf8");
  const begin = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (begin < 0 || end < begin) throw new Error("doc_markers_missing");
  writeFileSync(path, `${doc.slice(0, begin + BEGIN.length)}\n${body}\n${doc.slice(end)}`);
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: { type: "string", default: DEFAULT_MODEL },
      root: { type: "string", default: HERE },
      doc: { type: "string", default: resolve(HERE, "..", "..", "docs", "youtube-phase0-result.md") },
    },
  });
  const root = resolveRoot(values.root);
  const condition = { model: values.model, promptSha: PROMPT_SHA };
  const videosPath = join(root, "videos.json");
  if (!existsSync(videosPath)) {
    complain("videos.json이 없습니다.");
    return 2;
  }
  const videos = loadJson(videosPath);
  const errors = validateVideos(videos);
  if (errors.length) {
    for (const e of errors) complain(`입력 거부: ${e}`);
    return 2;
  }
  const allRuns = loadAllRuns(root);
  const ledgerErrors = checkLedger(readLedger(root), [...allRuns.values()].flat());
  if (ledgerErrors.length) {
    for (const e of ledgerErrors) complain(`원장 불일치: ${e}`);
    throw new Error("ledger_mismatch");
  }
  const pricingPath = join(root, "pricing.json");
  const pricing = existsSync(pricingPath) ? loadJson(pricingPath) : null;
  const evaluated = [];
  const counts = { missing: 0, invalid: 0, changed: 0 };
  for (const video of videos) {
    const runs = allRuns.get(video.id) ?? [];
    const base = {
      id: video.id,
      language: video.language,
      rights_basis: video.rights_basis,
      burned_in_subtitles: video.burned_in_subtitles,
      duration_sec: video.duration_sec,
      runs: runs.length,
      cost: costOfRuns(runs, pricing),
    };
    const path = labelPath(root, video.id);
    if (!existsSync(path)) {
      counts.missing++;
      evaluated.push({ ...base, status: "label_missing" });
      continue;
    }
    const labelBytes = readFileSync(path);
    const label = JSON.parse(labelBytes.toString("utf8"));
    const labelErrors = validateLabel(label, video);
    if (labelErrors.length) {
      counts.invalid++;
      for (const e of labelErrors) complain(`${video.id} 라벨 오류: ${e}`);
      evaluated.push({ ...base, status: "label_invalid" });
      continue;
    }
    const result = evaluateVideo(base, video, label, sha256(labelBytes), runs, condition);
    if (result.status === "label_changed") counts.changed++;
    evaluated.push(result);
  }
  const ok = evaluated.filter((v) => v.status === "ok");
  const distinct = (xs) => [...new Set(xs)];
  const everyRun = [...allRuns.values()].flat();
  const failures = {};
  for (const r of everyRun) if (r.status !== "ok") failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  const offsetPath = join(root, "output", "offset-check.json");
  const offset = existsSync(offsetPath) ? loadJson(offsetPath) : null;
  const scenes = { human_total: 0, human_covered: 0, model_total: 0, model_near_human: 0 };
  for (const v of ok) if (v.scenes) for (const k of Object.keys(scenes)) scenes[k] += v.scenes[k];
  const pricingSources = distinct(everyRun.map((r) => r.model_requested))
    .map((model) => ({ model, entry: resolvePricing(pricing, model) }))
    .filter((p) => p.entry)
    .map((p) => ({ model: p.model, source_url: p.entry.source_url, checked_at: p.entry.checked_at }));
  const metrics = {
    generated_at: new Date().toISOString(),
    videos: evaluated,
    summary: {
      condition: { model: condition.model, prompt_sha256: condition.promptSha },
      excluded_other_condition_runs: everyRun.length - eligibleRuns(everyRun, condition).length,
      conditions: {
        model_versions: distinct(ok.flatMap((v) => v.model_versions)),
        dates: distinct(ok.map((v) => v.started_at.slice(0, 10))),
        schema_sha256: distinct(ok.map((v) => v.schema_sha256)),
        temperatures: distinct(ok.map((v) => v.temperature)),
      },
      offset_check: offset ? { verdict: offset.verdict, model: offset.model, checked_at: offset.checked_at } : null,
      cer_by_language: aggregateCerByLanguage(ok),
      numbers: poolRate(ok, "numbers"),
      proper_nouns: poolRate(ok, "proper_nouns"),
      timing: aggregateTiming(ok),
      nonspeech: {
        all: sumNonspeech(ok.map((v) => v.nonspeech)),
        burned_in: sumNonspeech(ok.filter((v) => v.burned_in_subtitles).map((v) => v.nonspeech)),
        no_burned_in: sumNonspeech(ok.filter((v) => !v.burned_in_subtitles).map((v) => v.nonspeech)),
      },
      scenes,
      rejected: sumRejections(ok),
      failures,
      missing_labels: counts.missing,
      invalid_labels: counts.invalid,
      changed_labels: counts.changed,
      total_cost: costOfRuns(everyRun, pricing),
      pricing_sources: pricingSources,
      long_video: longVideoStatus(evaluated, allRuns),
    },
  };
  const outDir = join(root, "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2));
  updateDoc(values.doc, renderDoc(metrics));
  say(`측정 완료: 영상 ${ok.length}/${evaluated.length}, 라벨 없음 ${counts.missing}, 라벨 오류 ${counts.invalid}, 라벨 변경 ${counts.changed}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    complain(`오류 분류=${KNOWN_ERRORS.has(error?.message) ? error.message : error instanceof SyntaxError ? "invalid_json_file" : "internal_error"}`);
    process.exitCode = 2;
  }
}
