// Phase 0 측정용 순수 함수(입출력 없음). 지표 정의는 docs/youtube-phase0-result.md 1장과 일치해야 한다.

export const TOLERANCE_SEC = 10;
export const LONG_VIDEO_SEC = 1200;
export const TWO_HOURS_SEC = 7200;
const SIGNIFICANCE_Z = 2.33; // 단측 유의수준 약 0.01

const FILLERS = new Set(["어", "음", "그"]);
const SEPARATORS = /[\p{P}\p{S}\p{Z}\p{Cc}\p{Cf}\p{Co}\s]+/u;
const NONSPEECH_TAG = /[[(（【]\s*(?:음악|music)\s*[\])）】]/giu;
const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NONSPEECH_KINDS = new Set(["silence", "music", "lyrics"]);

// ---- 정규화 ----

// NFKC, 영문 소문자, 공백·문장부호 제거. 간투사는 공백·부호로 분리된 단독 토큰일 때만 뺀다("그래서"의 "그"는 유지).
export function normalizeText(text, { ignoreFillers = false } = {}) {
  const tokens = text.normalize("NFKC").toLowerCase().split(SEPARATORS).filter(Boolean);
  return (ignoreFillers ? tokens.filter((t) => !FILLERS.has(t)) : tokens).join("");
}

export function stripNonspeechTags(text) {
  return text.replace(NONSPEECH_TAG, " ");
}

export function isNonspeechTagOnly(text) {
  const stripped = stripNonspeechTags(text);
  return stripped !== text && normalizeText(stripped) === "";
}

// ---- 정렬 ----

const OP_DIAG = 1;
const OP_DEL = 2;
const OP_INS = 3;

// 정답(ref)은 전부, 전사(hyp)는 일부 구간과 맞춘다(양끝 전사는 비용 없음). 전사 위치와 무관하게 글자만 비교한다.
export function alignSemiGlobal(ref, hyp) {
  const m = ref.length;
  const n = hyp.length;
  const width = n + 1;
  const ops = new Uint8Array((m + 1) * width);
  let prev = new Uint32Array(width);
  let cur = new Uint32Array(width);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    ops[i * width] = OP_DEL;
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      if (diag <= del && diag <= ins) {
        cur[j] = diag;
        ops[i * width + j] = OP_DIAG;
      } else if (del <= ins) {
        cur[j] = del;
        ops[i * width + j] = OP_DEL;
      } else {
        cur[j] = ins;
        ops[i * width + j] = OP_INS;
      }
    }
    [prev, cur] = [cur, prev];
  }
  let end = 0;
  for (let j = 1; j <= n; j++) if (prev[j] < prev[end]) end = j;

  const refToHyp = new Int32Array(m).fill(-1);
  const matched = new Uint8Array(m);
  const substituted = new Uint8Array(m);
  const insertions = []; // 값 p: ref[p] 앞에 끼어든 전사 글자
  let i = m;
  let j = end;
  while (i > 0) {
    const op = ops[i * width + j];
    if (op === OP_DIAG) {
      refToHyp[i - 1] = j - 1;
      if (ref[i - 1] === hyp[j - 1]) matched[i - 1] = 1;
      else substituted[i - 1] = 1;
      i--;
      j--;
    } else if (op === OP_DEL) {
      i--;
    } else {
      insertions.push(i);
      j--;
    }
  }
  // [hypStart, hypEnd): 정렬에 쓰인 전사 범위. 밖의 글자는 비용 없이 남은 양끝이다.
  return { refToHyp, matched, substituted, insertions, hypStart: j, hypEnd: end };
}

export function tallyErrors(alignment, exemptRanges = []) {
  const m = alignment.refToHyp.length;
  const exempt = new Uint8Array(m);
  const exemptInsert = new Uint8Array(m + 1);
  for (const [a, b] of exemptRanges) {
    exempt.fill(1, a, b);
    exemptInsert.fill(1, a, b + 1);
  }
  let substitutions = 0;
  let deletions = 0;
  let refSyllables = 0;
  for (let k = 0; k < m; k++) {
    if (exempt[k]) continue;
    refSyllables++;
    if (alignment.substituted[k]) substitutions++;
    else if (alignment.refToHyp[k] < 0) deletions++;
  }
  const insertions = alignment.insertions.filter((p) => !exemptInsert[p]).length;
  return { substitutions, deletions, insertions, ref_syllables: refSyllables };
}

export function cerOf({ substitutions, deletions, insertions, ref_syllables }) {
  return ref_syllables > 0 ? (substitutions + deletions + insertions) / ref_syllables : null;
}

// ---- 숫자·고유명사 ----

const isDigit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";

function containsForm(span, form) {
  for (let i = span.indexOf(form); i >= 0; i = span.indexOf(form, i + 1)) {
    const leftOk = !(isDigit(form[0]) && isDigit(span[i - 1]));
    const rightOk = !(isDigit(form[form.length - 1]) && isDigit(span[i + form.length]));
    if (leftOk && rightOk) return true;
  }
  return false;
}

const SPAN_BREAK = "\u0000"; // 두 조각이 이어져 오탐되지 않게 끼우는 구분자(정규화 결과에는 나오지 않음)

// 정답 [a,b) 양옆에서 글자가 일치한 지점 사이의 전사 글자를 돌려준다. 어느 경우든 기준점에서 maxLen 글자 안만 본다.
function hypSpan(alignment, a, b, hyp, maxLen) {
  const m = alignment.refToHyp.length;
  let left = null;
  for (let i = a - 1; i >= 0 && left === null; i--) if (alignment.matched[i]) left = alignment.refToHyp[i] + 1;
  let right = null;
  for (let i = b; i < m && right === null; i++) if (alignment.matched[i]) right = alignment.refToHyp[i];
  if (left === null && right === null) return "";
  if (left === null) return hyp.slice(Math.max(0, right - maxLen), right).join("");
  if (right === null) return hyp.slice(left, Math.min(hyp.length, left + maxLen)).join("");
  if (right - left <= maxLen) return hyp.slice(left, right).join("");
  return `${hyp.slice(left, left + maxLen).join("")}${SPAN_BREAK}${hyp.slice(right - maxLen, right).join("")}`;
}

function mentionFound(alignment, a, b, hyp, forms) {
  const maxLen = Math.max(...forms.map((f) => Array.from(f).length)) + 2;
  const span = hypSpan(alignment, a, b, hyp, maxLen);
  return forms.some((f) => containsForm(span, f));
}

// 라벨의 numbers·proper_nouns를 정규화 문장 안의 위치로 바꾼다. 위치를 못 찾으면 null.
function locateMentions(label, opts) {
  const located = [];
  const cursor = new Map();
  const add = (kind, item, forms) => {
    const seg = label.segments[item.segment];
    if (!seg) return false;
    const text = Array.from(normalizeText(seg.text, opts)).join("");
    const surface = normalizeText(item.surface, opts);
    if (!surface) return false;
    const key = `${kind}:${item.segment}`;
    const at = text.indexOf(surface, cursor.get(key) ?? 0);
    if (at < 0) return false;
    cursor.set(key, at + surface.length);
    const start = Array.from(text.slice(0, at)).length;
    located.push({
      kind,
      segment: item.segment,
      start,
      end: start + Array.from(surface).length,
      forms: [...new Set([surface, ...forms.map((f) => normalizeText(f, opts)).filter(Boolean)])],
    });
    return true;
  };
  for (const item of label.numbers ?? []) if (!add("number", item, item.forms ?? [])) return null;
  for (const item of label.proper_nouns ?? []) if (!add("proper_noun", item, item.aliases ?? [])) return null;
  return located;
}

// ---- 전사·시각 ----

const inWindow = (seg, win) => seg.t_start >= win.start && seg.t_start < win.end;

export function randomBaselineP(tRef, durationSec, tolerance = TOLERANCE_SEC) {
  const overlap = Math.min(durationSec, tRef + tolerance) - Math.max(0, tRef - tolerance);
  return Math.min(1, overlap / durationSec);
}

export function evaluateTranscript(label, hypSegments, durationSec) {
  const opts = { ignoreFillers: label.fillers === "ignore" };
  const hypTexts = hypSegments.map((s) => Array.from(normalizeText(stripNonspeechTags(s.text), opts)));
  const mentions = locateMentions(label, opts) ?? [];
  const cer = { substitutions: 0, deletions: 0, insertions: 0, ref_syllables: 0 };
  const numbers = { total: 0, matched: 0 };
  const properNouns = { total: 0, matched: 0 };
  const timing = {
    total: 0,
    within_tolerance: 0,
    unaligned: 0,
    excluded_empty: 0,
    baseline_sum: 0,
    baseline_var: 0,
    quartile_errors: [[], [], [], []],
    quartile_hits: [0, 0, 0, 0],
  };

  for (const win of label.eval_windows) {
    // 전사는 창 ±허용오차 안에 시작하는 구간만 쓴다. 창 안에 시작하는 구간의 글자가 정렬 밖에 남으면 삽입이다.
    const hyp = [];
    const hypCharSeg = [];
    const hypInWindow = [];
    hypSegments.forEach((s, idx) => {
      if (s.t_start < win.start - TOLERANCE_SEC || s.t_start >= win.end + TOLERANCE_SEC) return;
      const inside = s.t_start >= win.start && s.t_start < win.end;
      for (const ch of hypTexts[idx]) {
        hyp.push(ch);
        hypCharSeg.push(idx);
        hypInWindow.push(inside);
      }
    });
    const ref = [];
    const ranges = new Map();
    label.segments.forEach((seg, idx) => {
      if (!inWindow(seg, win)) return;
      const chars = Array.from(normalizeText(seg.text, opts));
      if (!chars.length) {
        timing.excluded_empty++;
        return;
      }
      ranges.set(idx, [ref.length, ref.length + chars.length]);
      for (const ch of chars) ref.push(ch);
    });
    if (!ref.length) {
      cer.insertions += hypInWindow.filter(Boolean).length;
      continue;
    }
    const alignment = alignSemiGlobal(ref, hyp);
    const inside = mentions
      .filter((m) => ranges.has(m.segment))
      .map((m) => ({ ...m, a: ranges.get(m.segment)[0] + m.start, b: ranges.get(m.segment)[0] + m.end }));
    const tally = tallyErrors(alignment, inside.filter((m) => m.kind === "number").map((m) => [m.a, m.b]));
    for (let k = 0; k < hyp.length; k++) if (hypInWindow[k] && (k < alignment.hypStart || k >= alignment.hypEnd)) tally.insertions++;
    for (const key of Object.keys(cer)) cer[key] += tally[key];

    for (const m of inside) {
      const bucket = m.kind === "number" ? numbers : properNouns;
      bucket.total++;
      if (mentionFound(alignment, m.a, m.b, hyp, m.forms)) bucket.matched++;
    }

    for (const [idx, [a, b]] of ranges) {
      const seg = label.segments[idx];
      const p = randomBaselineP(seg.t_start, durationSec);
      timing.total++;
      timing.baseline_sum += p;
      timing.baseline_var += p * (1 - p);
      let hits = 0;
      let first = -1;
      for (let k = a; k < b; k++) {
        if (!alignment.matched[k]) continue;
        hits++;
        if (first < 0) first = alignment.refToHyp[k];
      }
      if (b === a || hits / (b - a) < 0.5) {
        timing.unaligned++;
        continue;
      }
      const error = Math.abs(hypSegments[hypCharSeg[first]].t_start - seg.t_start);
      const q = Math.min(3, Math.floor((seg.t_start / durationSec) * 4));
      timing.quartile_errors[q].push(error);
      if (error <= TOLERANCE_SEC) {
        timing.within_tolerance++;
        timing.quartile_hits[q]++;
      }
    }
  }
  return {
    cer: { ...cer, cer: cerOf(cer) },
    numbers: { ...numbers, rate: numbers.total ? numbers.matched / numbers.total : null },
    proper_nouns: { ...properNouns, rate: properNouns.total ? properNouns.matched / properNouns.total : null },
    timing: { ...timing, rate: timing.total ? timing.within_tolerance / timing.total : null },
  };
}

// ---- 비발화 ----

// 경계 ±허용오차 안쪽 띠는 시각 오차일 수 있어 분리한다. 가사 구간은 허위 분모에서 뺀다.
export function evaluateNonspeech(label, hypSegments, tolerance = TOLERANCE_SEC) {
  const out = { intervals: 0, outside_tolerance: 0, within_tolerance: 0, tags: 0, lyrics: 0, inner_minutes: 0, band_minutes: 0 };
  for (const iv of label.nonspeech ?? []) {
    out.intervals++;
    const isLyrics = iv.kind === "lyrics";
    const len = iv.end - iv.start;
    const inner = Math.max(0, len - 2 * tolerance);
    if (!isLyrics) {
      out.inner_minutes += inner / 60;
      out.band_minutes += (len - inner) / 60;
    }
    const innerStart = iv.start + tolerance;
    const innerEnd = iv.end - tolerance;
    for (const s of hypSegments) {
      if (s.t_end <= iv.start || s.t_start >= iv.end) continue;
      if (isNonspeechTagOnly(s.text)) {
        out.tags++;
        continue;
      }
      if (!normalizeText(s.text)) continue;
      if (isLyrics) out.lyrics++;
      else if (inner > 0 && s.t_start < innerEnd && s.t_end > innerStart) out.outside_tolerance++;
      else out.within_tolerance++;
    }
  }
  return out;
}

export function sumNonspeech(list) {
  const total = { videos: 0, outside_tolerance: 0, within_tolerance: 0, tags: 0, lyrics: 0, inner_minutes: 0, band_minutes: 0 };
  for (const item of list) {
    if (item.intervals > 0) total.videos++;
    for (const key of ["outside_tolerance", "within_tolerance", "tags", "lyrics", "inner_minutes", "band_minutes"]) total[key] += item[key];
  }
  const measurable = total.inner_minutes > 0;
  return {
    ...total,
    measurable,
    outside_per_minute: measurable ? total.outside_tolerance / total.inner_minutes : null,
    within_per_minute: total.band_minutes > 0 ? total.within_tolerance / total.band_minutes : null,
  };
}

// ---- 장면(참고값) ----

export function evaluateScenes(label, hypScenes, tolerance = TOLERANCE_SEC) {
  if (!label.scenes) return null;
  const inside = (t) => label.eval_windows.some((w) => t >= w.start && t < w.end);
  const human = label.scenes.map((s) => s.t).filter(inside);
  const model = hypScenes.map((s) => s.t).filter(inside);
  const near = (a, list) => list.some((b) => Math.abs(a - b) <= tolerance);
  return {
    human_total: human.length,
    human_covered: human.filter((t) => near(t, model)).length,
    model_total: model.length,
    model_near_human: model.filter((t) => near(t, human)).length,
  };
}

// ---- 시각 검증·분할 ----

const REJECT_KEYS = ["non_finite", "out_of_range", "reversed", "out_of_order", "overlap", "duplicate"];
const emptyRejects = () => Object.fromEntries(REJECT_KEYS.map((k) => [k, 0]));

// 제품 설계의 시각 검증: 0 ≤ t < 길이, 순서·중복. 위반은 버리고 건수만 남긴다.
export function validateSegments(segments, durationSec) {
  const rejected = emptyRejects();
  const kept = [];
  let last = null;
  for (const s of segments) {
    let reason = null;
    if (!Number.isFinite(s.t_start) || !Number.isFinite(s.t_end)) reason = "non_finite";
    else if (s.t_start < 0 || s.t_start >= durationSec || s.t_end > durationSec) reason = "out_of_range";
    else if (s.t_end <= s.t_start) reason = "reversed";
    else if (last && s.t_start < last.t_start) reason = "out_of_order";
    else if (last && s.t_start < last.t_end) reason = "overlap";
    if (reason) {
      rejected[reason]++;
      continue;
    }
    kept.push(s);
    last = s;
  }
  return { kept, rejected };
}

export function validateScenes(scenes, durationSec) {
  const rejected = emptyRejects();
  const kept = [];
  let last = null;
  for (const s of scenes) {
    let reason = null;
    if (!Number.isFinite(s.t)) reason = "non_finite";
    else if (s.t < 0 || s.t >= durationSec) reason = "out_of_range";
    else if (last !== null && s.t < last) reason = "out_of_order";
    else if (last !== null && s.t === last) reason = "duplicate";
    if (reason) {
      rejected[reason]++;
      continue;
    }
    kept.push(s);
    last = s.t;
  }
  return { kept, rejected };
}

export function planChunks(durationSec, chunkSec = 1200, overlapSec = 30) {
  if (!(chunkSec > overlapSec) || overlapSec < 0) throw new RangeError("invalid_chunk_options");
  if (durationSec <= chunkSec) return [{ index: 0, start: 0, end: durationSec, clipped: false }];
  const chunks = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + chunkSec, durationSec);
    chunks.push({ index: chunks.length, start, end, clipped: true });
    if (end >= durationSec) return chunks;
    start = end - overlapSec;
  }
}

// 분할 호출 결과를 절대 시각으로 합친다. 겹침 구간은 가운데를 경계로 한쪽만 남긴다.
export function mergeChunks(chunkResults, timeBase, durationSec, overlapSec) {
  const toAbs = (t, chunk) => (timeBase === "relative" ? t + chunk.start : t);
  const segments = [];
  const scenes = [];
  let outsideChunk = 0;
  let overlapTrimmed = 0;
  chunkResults.forEach(({ chunk, parsed }, idx) => {
    const lo = idx === 0 ? 0 : chunk.start + overlapSec / 2;
    const next = chunkResults[idx + 1]?.chunk;
    const hi = next ? next.start + overlapSec / 2 : durationSec;
    const place = (t) => {
      if (!Number.isFinite(t) || t < chunk.start || t >= chunk.end) {
        outsideChunk++;
        return false;
      }
      if (t < lo || t >= hi) {
        overlapTrimmed++;
        return false;
      }
      return true;
    };
    for (const s of parsed.segments) {
      const out = { ...s, t_start: toAbs(s.t_start, chunk), t_end: toAbs(s.t_end, chunk) };
      if (chunkResults.length === 1 || place(out.t_start)) segments.push(out);
    }
    for (const s of parsed.scenes) {
      const out = { ...s, t: toAbs(s.t, chunk) };
      if (chunkResults.length === 1 || place(out.t)) scenes.push(out);
    }
  });
  const seg = validateSegments(segments, durationSec);
  const sc = validateScenes(scenes, durationSec);
  return {
    segments: seg.kept,
    scenes: sc.kept,
    rejected: {
      segments: seg.rejected,
      scenes: sc.rejected,
      outside_chunk: outsideChunk,
      overlap_trimmed: overlapTrimmed,
    },
  };
}

// 자른 영상의 시각이 절대값인지 상대값인지 대조 실험 결과로 판정한다.
export function classifyOffset(controlSegments, testSegments, clip, tolerance = 5, threshold = 0.8) {
  const share = (list, lo, hi) => (list.length ? list.filter((s) => s.t_start >= lo - tolerance && s.t_start <= hi + tolerance).length / list.length : 0);
  const length = clip.end - clip.start;
  if (share(controlSegments, 0, length) < threshold) return "inconclusive";
  if (share(testSegments, clip.start, clip.end) >= threshold) return "absolute";
  if (share(testSegments, 0, length) >= threshold) return "relative";
  return "inconclusive";
}

// ---- 응답 해석·실행 선택 ----

export function parseGeminiResponse(raw) {
  const modelVersion = typeof raw?.modelVersion === "string" ? raw.modelVersion : null;
  const fail = (failure, finishReason = null) => ({ ok: false, failure, finishReason, modelVersion });
  const candidate = raw?.candidates?.[0];
  if (!candidate) return fail(raw?.promptFeedback?.blockReason ? "blocked" : "no_candidate");
  const finishReason = /^[A-Z_]+$/.test(candidate.finishReason ?? "") ? candidate.finishReason : "UNKNOWN";
  if (finishReason === "MAX_TOKENS" || finishReason === "UNKNOWN") return fail("truncated", finishReason);
  if (finishReason !== "STOP") return fail("blocked", finishReason);
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("invalid_json", finishReason);
  }
  const segmentsOk = Array.isArray(parsed?.segments) && parsed.segments.every((s) => typeof s?.t_start === "number" && typeof s?.t_end === "number" && typeof s?.text === "string");
  const scenesOk = Array.isArray(parsed?.scenes) && parsed.scenes.every((s) => typeof s?.t === "number" && typeof s?.title === "string" && typeof s?.description === "string");
  if (!segmentsOk || !scenesOk) return fail("schema_mismatch", finishReason);
  return {
    ok: true,
    finishReason,
    modelVersion,
    segments: parsed.segments.map(({ t_start, t_end, text: t }) => ({ t_start, t_end, text: t })),
    scenes: parsed.scenes.map(({ t, title, description }) => ({ t, title, description })),
  };
}

// 현재 측정 조건(모델·프롬프트)의 실행만 대상으로 한다.
export function eligibleRuns(runs, { model, promptSha }) {
  return runs.filter((r) => r.model_requested === model && r.prompt_sha256 === promptSha);
}

// 좋은 결과를 고르지 못하게 현재 조건에서 가장 앞선 유효 실행만 채택한다.
export function selectAdoptedRun(runs, condition) {
  return [...eligibleRuns(runs, condition)].sort((a, b) => a.run_index - b.run_index).find((r) => r.status === "ok") ?? null;
}

// append-only 원장과 응답 파일이 1:1로 맞는지 확인한다. files: { video_id, run_index, status, file_sha256 }[]
export function checkLedger(ledger, files) {
  const errors = [];
  const key = (e) => `${e.video_id}#${e.run_index}`;
  const byKey = new Map();
  for (const entry of ledger) {
    if (byKey.has(key(entry))) errors.push(`${key(entry)}:duplicate_entry`);
    byKey.set(key(entry), entry);
  }
  const seen = new Set();
  for (const file of files) {
    seen.add(key(file));
    const entry = byKey.get(key(file));
    if (!entry) errors.push(`${key(file)}:missing_in_ledger`);
    else if (entry.status !== file.status) errors.push(`${key(file)}:status_mismatch`);
    else if (entry.file_sha256 !== file.file_sha256) errors.push(`${key(file)}:file_changed`);
  }
  for (const k of byKey.keys()) if (!seen.has(k)) errors.push(`${k}:missing_file`);
  return errors;
}

// ---- 입력 검증 ----

export function extractVideoId(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !ALLOWED_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let id = null;
  if (url.hostname === "youtu.be") id = parts.length === 1 ? parts[0] : null;
  else if (parts.length === 1 && parts[0] === "watch") id = url.searchParams.get("v");
  else if (parts.length === 2 && parts[0] === "shorts") id = parts[1];
  return id && VIDEO_ID.test(id) ? id : null;
}

// 오류는 위치와 고정 코드만 돌려준다(값을 싣지 않는다).
export function validateVideos(list) {
  if (!Array.isArray(list) || !list.length) return ["videos:not_a_non_empty_array"];
  const errors = [];
  const seen = new Set();
  list.forEach((v, i) => {
    const at = `videos[${i}]`;
    if (typeof v?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.id)) errors.push(`${at}.id:invalid`);
    else if (seen.has(v.id)) errors.push(`${at}.id:duplicate`);
    else seen.add(v.id);
    if (typeof v?.url !== "string" || !extractVideoId(v.url)) errors.push(`${at}.url:not_public_youtube`);
    if (typeof v?.language !== "string" || !v.language.trim()) errors.push(`${at}.language:missing`);
    if (typeof v?.rights_basis !== "string" || !v.rights_basis.trim()) errors.push(`${at}.rights_basis:missing`);
    if (!(Number.isFinite(v?.duration_sec) && v.duration_sec > 0)) errors.push(`${at}.duration_sec:invalid`);
    if (typeof v?.burned_in_subtitles !== "boolean") errors.push(`${at}.burned_in_subtitles:not_boolean`);
    if (typeof v?.has_nonspeech !== "boolean") errors.push(`${at}.has_nonspeech:not_boolean`);
  });
  return errors;
}

export function validateLabel(label, video) {
  const errors = [];
  if (label?.video_id !== video.id) errors.push("video_id:mismatch");
  if (!["ignore", "keep"].includes(label?.fillers)) errors.push("fillers:invalid");
  const windows = label?.eval_windows;
  if (!Array.isArray(windows) || !windows.length) return [...errors, "eval_windows:missing"];
  let covered = 0;
  let prevEnd = 0;
  windows.forEach((w, i) => {
    if (!(Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.start >= prevEnd && w.end > w.start && w.end <= video.duration_sec)) errors.push(`eval_windows[${i}]:invalid`);
    else {
      covered += w.end - w.start;
      prevEnd = w.end;
    }
  });
  if (video.duration_sec > LONG_VIDEO_SEC && covered >= video.duration_sec) errors.push("eval_windows:whole_long_video_labeled");
  if (!Array.isArray(label?.segments) || !label.segments.length) return [...errors, "segments:missing"];
  // 정규화(간투사 규칙 포함) 뒤 빈 문장은 오류가 아니라 평가 제외. 평가할 문장이 하나도 없으면 오류.
  const opts = { ignoreFillers: label.fillers === "ignore" };
  let segmentsValid = true;
  let evaluable = 0;
  label.segments.forEach((s, i) => {
    if (!(Number.isFinite(s?.t_start) && Number.isFinite(s?.t_end) && s.t_end > s.t_start && typeof s?.text === "string")) {
      errors.push(`segments[${i}]:invalid`);
      segmentsValid = false;
    } else if (!windows.some((w) => inWindow(s, w))) errors.push(`segments[${i}]:outside_eval_windows`);
    else if (normalizeText(s.text, opts)) evaluable++;
  });
  if (segmentsValid && !evaluable) errors.push("segments:no_evaluable");
  if (segmentsValid) {
    for (const key of ["numbers", "proper_nouns"]) {
      const list = label[key];
      if (list !== undefined && !Array.isArray(list)) errors.push(`${key}:not_array`);
      else if (list?.some((m) => !Number.isInteger(m?.segment) || typeof m?.surface !== "string")) errors.push(`${key}:invalid_item`);
    }
    if (!errors.some((e) => e.startsWith("numbers") || e.startsWith("proper_nouns")) && !locateMentions(label, opts)) errors.push("mentions:surface_not_found");
  }
  if (label.numbers?.some?.((m) => !Array.isArray(m?.forms) || !m.forms.length)) errors.push("numbers:forms_missing");
  const nonspeech = label.nonspeech ?? [];
  if (!Array.isArray(nonspeech)) errors.push("nonspeech:not_array");
  else {
    nonspeech.forEach((iv, i) => {
      if (!(Number.isFinite(iv?.start) && Number.isFinite(iv?.end) && iv.start >= 0 && iv.end > iv.start && iv.end <= video.duration_sec && NONSPEECH_KINDS.has(iv?.kind))) errors.push(`nonspeech[${i}]:invalid`);
    });
    if (video.has_nonspeech !== nonspeech.length > 0) errors.push("nonspeech:has_nonspeech_mismatch");
  }
  if (label.scenes !== undefined && !(Array.isArray(label.scenes) && label.scenes.every((s) => Number.isFinite(s?.t)))) errors.push("scenes:invalid");
  return errors;
}

// ---- 비용·집계 ----

export function resolvePricing(pricing, model) {
  const entry = pricing?.[model];
  const fields = ["input_per_1m_usd", "output_per_1m_usd", "thinking_per_1m_usd"];
  if (!entry || !fields.every((f) => Number.isFinite(entry[f]) && entry[f] >= 0)) return null;
  if (typeof entry.source_url !== "string" || !entry.source_url || typeof entry.checked_at !== "string" || !entry.checked_at) return null;
  return entry;
}

export function costUsd(tokens, entry) {
  if (!entry) return null;
  return (tokens.input * entry.input_per_1m_usd + tokens.output * entry.output_per_1m_usd + tokens.thoughts * entry.thinking_per_1m_usd) / 1_000_000;
}

// 영상의 모든 실행(실패·재시도 포함) 토큰을 실행별 모델 단가로 합산한다. 단가 미확인 실행이 하나라도 있으면 금액은 null.
export function costOfRuns(runs, pricing) {
  const tokens = { input: 0, output: 0, thoughts: 0, total: 0 };
  let cost = 0;
  let unpriced = 0;
  for (const run of runs) {
    const t = sumRunTokens(run);
    for (const k of Object.keys(tokens)) tokens[k] += t[k];
    const c = costUsd(t, resolvePricing(pricing, run.model_requested));
    if (c === null) unpriced++;
    else cost += c;
  }
  return { runs: runs.length, tokens, cost_usd: unpriced ? null : cost, unpriced_runs: unpriced };
}

export function sumRunTokens(run) {
  const total = { input: 0, output: 0, thoughts: 0, total: 0 };
  for (const chunk of run.chunks) {
    for (const attempt of chunk.attempts) {
      if (!attempt.usage) continue;
      for (const key of Object.keys(total)) total[key] += attempt.usage[key] ?? 0;
    }
  }
  return total;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function dispersion(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  return { runs: n, mean: m, stdev: Math.sqrt(values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1)), min: Math.min(...values), max: Math.max(...values) };
}

export function aggregateTiming(videos) {
  let total = 0;
  let hits = 0;
  let unaligned = 0;
  let excludedEmpty = 0;
  let sum = 0;
  let variance = 0;
  const errors = [[], [], [], []];
  const quartileHits = [0, 0, 0, 0];
  for (const { timing } of videos) {
    total += timing.total;
    hits += timing.within_tolerance;
    unaligned += timing.unaligned;
    excludedEmpty += timing.excluded_empty ?? 0;
    sum += timing.baseline_sum;
    variance += timing.baseline_var;
    timing.quartile_errors.forEach((list, q) => {
      errors[q].push(...list);
      quartileHits[q] += timing.quartile_hits[q];
    });
  }
  const z = variance > 0 ? (hits - sum) / Math.sqrt(variance) : null;
  return {
    total,
    within_tolerance: hits,
    unaligned,
    excluded_empty: excludedEmpty,
    rate: total ? hits / total : null,
    random_baseline: total ? sum / total : null,
    z,
    significant: z === null ? null : z >= SIGNIFICANCE_Z,
    quartiles: errors.map((list, q) => ({
      quartile: q + 1,
      aligned: list.length,
      mean_error_sec: mean(list),
      median_error_sec: median(list),
      hit_rate: list.length ? quartileHits[q] / list.length : null,
    })),
  };
}

export function aggregateCerByLanguage(videos) {
  const out = {};
  for (const v of videos) {
    if (v.cer.cer === null) continue;
    (out[v.language] ??= []).push(v);
  }
  return Object.fromEntries(
    Object.entries(out).map(([language, list]) => {
      const worst = list.reduce((a, b) => (b.cer.cer > a.cer.cer ? b : a));
      return [language, { videos: list.length, mean_cer: mean(list.map((v) => v.cer.cer)), worst_cer: worst.cer.cer, worst_video: worst.id }];
    }),
  );
}

export function poolRate(videos, key) {
  const total = videos.reduce((acc, v) => acc + v[key].total, 0);
  const matched = videos.reduce((acc, v) => acc + v[key].matched, 0);
  return { total, matched, rate: total ? matched / total : null };
}
