// task-013 골든셋 평가: 임베딩 모델 × 청크 설정별 검색 적중률·인용 정확도·no_answer 정확도.
// 실행: pnpm eval (로컬 TEI 서버 필요. 주소는 EVAL_BGE_M3_URL · EVAL_E5_BASE_URL로 바꿀 수 있다)
//
// 지표 정의(LLM 없이 검색만으로 잰다. 실제 답변 인용 검증은 task-015):
// - 검색 적중률(hit@3): 답이 있는 문항 중 상위 3개 청크에 정답 청크가 있는 비율
// - 인용 정확도(hit@1): 답이 있는 문항 중 1위 청크(인용 후보)가 정답 청크인 비율
// - no_answer 정확도: 1위 점수 < τ 면 "근거 없음"으로 판정했을 때 전체 문항 정답 비율(τ는 이 골든셋에서 가장 좋은 값)
// 정답 청크 = evidence 구간의 절반 이상을 덮는 청크(청크 설정이 바뀌어도 같은 골든셋을 쓴다).
import { readFileSync } from "node:fs";
import { chunkPages } from "../apps/worker/src/ingest/chunking.ts";
import { createTeiEmbeddingProvider } from "../apps/worker/src/ingest/embedding.ts";
import { CHUNK_SETTINGS } from "../apps/worker/src/ingest/settings.ts";

const here = (p) => new URL(p, import.meta.url);
const TOP_K = 3;
const PAGE_BREAK = /\n<<<쪽>>>\n/;

const MODELS = [
  { model: "bge-m3", dimensions: 1024, url: process.env.EVAL_BGE_M3_URL ?? "http://127.0.0.1:56530", query: "", passage: "" },
  {
    model: "multilingual-e5-base",
    dimensions: 768,
    url: process.env.EVAL_E5_BASE_URL ?? "http://127.0.0.1:56531",
    query: "query: ",
    passage: "passage: ",
  },
];

const CHUNK_CONFIGS = [
  { maxChars: 300, overlapChars: 60, minChars: 150 },
  { maxChars: 500, overlapChars: 100, minChars: 250 },
  { maxChars: 1000, overlapChars: 150, minChars: 500 },
];

const golden = JSON.parse(readFileSync(here("./golden.json"), "utf8")).items;
const docNames = [...new Set(golden.map((g) => g.doc).filter(Boolean))];
const docs = Object.fromEntries(
  docNames.map((name) => {
    const raw = readFileSync(here(`./corpus/${name}.txt`), "utf8").replace(/\r\n/g, "\n");
    return [name, raw.split(PAGE_BREAK).map((text, i) => ({ page: i + 1, text: text.trim() }))];
  }),
);

// evidence 위치(쪽·문자 범위)를 미리 찾는다. 못 찾으면 골든셋 오류.
for (const g of golden) {
  if (g.no_answer) continue;
  const page = docs[g.doc]?.find((p) => p.text.includes(g.evidence));
  if (!page) throw new Error(`골든셋 ${g.id}: evidence를 문서에서 찾지 못했습니다`);
  const start = page.text.indexOf(g.evidence);
  g.span = { page: page.page, start, end: start + g.evidence.length };
}
const answerable = golden.filter((g) => !g.no_answer);
if (golden.length < 30 || golden.length > 50) throw new Error(`골든셋 문항 수 ${golden.length}개(30~50개 필요)`);

function isGold(chunk, g) {
  if (chunk.doc !== g.doc || chunk.locator.page !== g.span.page) return false;
  const overlap = Math.min(chunk.locator.char_end, g.span.end) - Math.max(chunk.locator.char_start, g.span.start);
  return overlap * 2 >= g.span.end - g.span.start;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function bestThreshold(rows) {
  // rows: { top1, noAnswer }. 후보 τ = 점수 사이 중간값
  const scores = [...new Set(rows.map((r) => r.top1))].sort((a, b) => a - b);
  const cands = [scores[0] - 1e-6, ...scores.slice(1).map((s, i) => (s + scores[i]) / 2), scores.at(-1) + 1e-6];
  let best = { tau: 0, acc: -1 };
  for (const tau of cands) {
    const acc = rows.filter((r) => r.top1 < tau === r.noAnswer).length / rows.length;
    if (acc > best.acc) best = { tau, acc };
  }
  return best;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const results = [];
console.log(`골든셋 문항 ${golden.length}개 (답 있음 ${answerable.length} · no_answer ${golden.length - answerable.length}), 문서 ${docNames.length}건`);

for (const m of MODELS) {
  const passageProvider = createTeiEmbeddingProvider({ url: m.url, model: m.model, dimensions: m.dimensions, prefix: m.passage });
  const queryProvider = createTeiEmbeddingProvider({ url: m.url, model: m.model, dimensions: m.dimensions, prefix: m.query });
  const qVecs = await queryProvider.embed(golden.map((g) => g.question));
  if (qVecs.some((v) => v.length !== m.dimensions)) throw new Error(`${m.model}: 차원이 ${m.dimensions}이 아닙니다`);

  for (const cfg of CHUNK_CONFIGS) {
    const chunks = docNames.flatMap((doc) => chunkPages(docs[doc], cfg).map((c) => ({ ...c, doc })));
    const cVecs = await passageProvider.embed(chunks.map((c) => c.content));
    let hit1 = 0;
    let hitK = 0;
    let rr = 0;
    const rows = golden.map((g, qi) => {
      const ranked = chunks.map((c, ci) => ({ c, s: dot(qVecs[qi], cVecs[ci]) })).sort((a, b) => b.s - a.s);
      if (!g.no_answer) {
        const rank = ranked.slice(0, TOP_K).findIndex((r) => isGold(r.c, g));
        if (rank === 0) hit1++;
        if (rank >= 0) {
          hitK++;
          rr += 1 / (rank + 1);
        }
      }
      return { top1: ranked[0].s, noAnswer: Boolean(g.no_answer) };
    });
    const na = bestThreshold(rows);
    const r = {
      model: m.model,
      dimensions: m.dimensions,
      chunk: `${cfg.maxChars}/${cfg.overlapChars}/${cfg.minChars}`,
      chunks: chunks.length,
      hitAtK: hitK / answerable.length,
      citation: hit1 / answerable.length,
      mrr: rr / answerable.length,
      noAnswer: na.acc,
      tau: na.tau,
    };
    results.push(r);
  }
}

console.log(`\n현재 설정 CHUNK_SETTINGS = ${CHUNK_SETTINGS.maxChars}/${CHUNK_SETTINGS.overlapChars}/${CHUNK_SETTINGS.minChars} (max/overlap/min)\n`);
console.log("| 모델 | 차원 | 청크 max/overlap/min | 청크 수 | 검색 적중률(hit@3) | 인용 정확도(hit@1) | MRR@3 | no_answer 정확도 | τ |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  console.log(
    `| ${r.model} | ${r.dimensions} | ${r.chunk} | ${r.chunks} | ${pct(r.hitAtK)} | ${pct(r.citation)} | ${r.mrr.toFixed(3)} | ${pct(r.noAnswer)} | ${r.tau.toFixed(3)} |`,
  );
}
