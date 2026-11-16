// task-013a 평가 스크립트: 청킹 변형 × 임베딩 모델 → 검색 적중률 · 인용 정확도 · no_answer 정확도.
// 실행: pnpm eval -- --mock   |   EMBED_URLS="bge-m3=http://localhost:8080" pnpm eval
// 옵션: --mock  --models name=url,name=url  --k 5  --out <dir>
// 환경: EMBED_URLS="name=url,..."  EMBED_PREFIXES="name=질의접두어||문서접두어;name2=..." (e5류: "e5=query: ||passage: ")
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkPages } from "../apps/worker/src/ingest/chunking.ts";
import type { EmbeddingProvider } from "../apps/worker/src/ingest/embedding.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

interface Golden {
  id: string;
  question: string;
  doc: string;
  answer_span: string;
  no_answer: boolean;
}
interface Variant {
  name: string;
  maxChars: number;
  overlapChars: number;
  minChars: number;
}
interface Prefix {
  query: string;
  passage: string;
}
interface Row {
  chunking: string;
  model: string;
  chunks: number;
  answerable: number;
  no_answer: number;
  hit_rate: number;
  citation_acc: number;
  no_answer_acc: number;
  threshold: number;
}

const VARIANTS: Variant[] = [
  { name: "1000/150", maxChars: 1000, overlapChars: 150, minChars: 500 }, // 현재 설정(CHUNK_SETTINGS)
  { name: "600/100", maxChars: 600, overlapChars: 100, minChars: 300 },
  { name: "1500/200", maxChars: 1500, overlapChars: 200, minChars: 750 },
];

function parseArgs(argv: string[]) {
  const a = argv.filter((x) => x !== "--");
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return { mock: a.includes("--mock"), models: get("--models"), k: Number(get("--k") ?? 5), out: get("--out") ?? path.join(root, "results") };
}

function parseMap(s: string | undefined, sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? "").split(sep)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1);
  }
  return out;
}

function parsePrefixes(s: string | undefined): Record<string, Prefix> {
  const out: Record<string, Prefix> = {};
  for (const [name, v] of Object.entries(parseMap(s, ";"))) {
    const [query = "", passage = ""] = v.split("||");
    out[name] = { query, passage };
  }
  return out;
}

/** TEI: POST {url}/embed {inputs:[...]} → number[][] . 배치 32개씩. */
function createTeiProvider(model: string, url: string, prefix: Prefix): EmbeddingProvider & { embedQuery(t: string[]): Promise<number[][]>; embedPassage(t: string[]): Promise<number[][]> } {
  async function call(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const res = await fetch(`${url.replace(/\/$/, "")}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: texts.slice(i, i + 32), truncate: true }),
      });
      if (!res.ok) throw new Error(`임베딩 서버 ${model} 응답 ${res.status}`);
      out.push(...((await res.json()) as number[][]));
    }
    return out;
  }
  return {
    model,
    dimensions: 0,
    embed: call,
    embedQuery: (t) => call(t.map((x) => prefix.query + x)),
    embedPassage: (t) => call(t.map((x) => prefix.passage + x)),
  };
}

/** 목: 문자 3-gram 해시 가방(결정적·네트워크 없음). 의미가 아니라 어휘 겹침만 반영하므로 수치는 배관 확인용이다. */
function mockEmbed(texts: string[], dim = 512): number[][] {
  return texts.map((t) => {
    const v = new Array<number>(dim).fill(0);
    const s = t.toLowerCase().replace(/\s+/g, " ");
    for (let i = 0; i + 3 <= s.length; i++) {
      let h = 2166136261;
      for (let j = i; j < i + 3; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619) >>> 0;
      v[h % dim]! += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** 정답 문항 top-1 유사도의 10번째 백분위수(낮은 쪽 10%). 이보다 낮으면 "근거 없음"으로 본다. */
function pickThreshold(scores: number[]): number {
  if (scores.length === 0) return 0;
  const s = [...scores].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.1)]!;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

interface Embedder {
  model: string;
  query(t: string[]): Promise<number[][]>;
  passage(t: string[]): Promise<number[][]>;
}

async function evaluate(embedder: Embedder, variant: Variant, docs: Map<string, string>, golden: Golden[], k: number): Promise<Row> {
  const chunks: { doc: string; content: string }[] = [];
  for (const [doc, text] of docs) {
    for (const c of chunkPages([{ page: 1, text }] as Parameters<typeof chunkPages>[0], variant)) chunks.push({ doc, content: c.content });
  }
  const cv = await embedder.passage(chunks.map((c) => c.content));
  const qv = await embedder.query(golden.map((g) => g.question));

  const results = golden.map((g, qi) => {
    const ranked = chunks.map((c, i) => ({ c, score: cosine(qv[qi]!, cv[i]!) })).sort((a, b) => b.score - a.score).slice(0, k);
    const isAnswer = (r: { c: { doc: string; content: string } }) => !g.no_answer && r.c.doc === g.doc && r.c.content.includes(g.answer_span);
    return { g, top1: ranked[0]?.score ?? 0, hit: ranked.some(isAnswer), cite: ranked[0] ? isAnswer(ranked[0]) : false };
  });

  const answerable = results.filter((r) => !r.g.no_answer);
  const noAnswer = results.filter((r) => r.g.no_answer);
  const threshold = pickThreshold(answerable.map((r) => r.top1));
  return {
    chunking: variant.name,
    model: embedder.model,
    chunks: chunks.length,
    answerable: answerable.length,
    no_answer: noAnswer.length,
    hit_rate: pct(answerable.filter((r) => r.hit).length, answerable.length),
    citation_acc: pct(answerable.filter((r) => r.cite).length, answerable.length),
    no_answer_acc: pct(noAnswer.filter((r) => r.top1 < threshold).length, noAnswer.length),
    threshold: Math.round(threshold * 1000) / 1000,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const golden = JSON.parse(readFileSync(path.join(root, "golden.json"), "utf8")) as Golden[];
  const docs = new Map<string, string>();
  for (const f of readdirSync(path.join(root, "corpus")).filter((x) => x.endsWith(".md")).sort()) {
    docs.set(f, readFileSync(path.join(root, "corpus", f), "utf8").replace(/\r\n/g, "\n"));
  }

  // 골든셋 검증: 정답 구절은 해당 문서에 실제로 있어야 하고 정확히 한 번만 나와야 한다.
  for (const g of golden) {
    if (!docs.has(g.doc)) throw new Error(`${g.id}: 문서 없음 ${g.doc}`);
    if (g.no_answer) continue;
    const n = docs.get(g.doc)!.split(g.answer_span).length - 1;
    if (n !== 1) throw new Error(`${g.id}: answer_span이 문서에 ${n}번 나옴`);
  }
  const noAns = golden.filter((g) => g.no_answer).length;
  console.log(`자료 ${docs.size}건 · 문항 ${golden.length}개 (정답 ${golden.length - noAns} · no_answer ${noAns}) · top-k ${args.k}`);

  const embedders: Embedder[] = [];
  if (args.mock) {
    embedders.push({ model: "mock-trigram", query: async (t) => mockEmbed(t), passage: async (t) => mockEmbed(t) });
  } else {
    const urls = parseMap(args.models ?? process.env.EMBED_URLS, ",");
    const prefixes = parsePrefixes(process.env.EMBED_PREFIXES);
    if (Object.keys(urls).length === 0) throw new Error('임베딩 서버가 없습니다. --models "bge-m3=http://localhost:8080" 또는 EMBED_URLS, 서버 없이 확인하려면 --mock');
    for (const [name, url] of Object.entries(urls)) {
      const p = createTeiProvider(name, url, prefixes[name] ?? { query: "", passage: "" });
      embedders.push({ model: name, query: p.embedQuery, passage: p.embedPassage });
    }
  }

  const rows: Row[] = [];
  for (const e of embedders) for (const v of VARIANTS) rows.push(await evaluate(e, v, docs, golden, args.k));

  console.log("\n| 청킹 | 모델 | 청크 | 검색 적중률(%) | 인용 정확도(%) | no_answer 정확도(%) | 임계값 |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.chunking} | ${r.model} | ${r.chunks} | ${r.hit_rate} | ${r.citation_acc} | ${r.no_answer_acc} | ${r.threshold} |`);
  console.log("\n정의: 적중률=top-k 안에 answer_span 포함 청크 존재 / 인용 정확도=top-1이 정답 청크 / no_answer 정확도=no_answer 문항 중 top-1 유사도가 임계값 미만인 비율.");
  console.log("임계값 규칙: 정답 문항 top-1 유사도의 하위 10% 지점(조합마다 고정 규칙으로 산출).");
  if (args.mock) console.log("주의: --mock은 문자 3-gram 어휘 겹침 목이다. 수치는 모델 비교에 쓸 수 없다(배관 확인용).");

  mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, `${new Date().toISOString().replace(/[:.]/g, "-")}${args.mock ? "-mock" : ""}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), mock: args.mock, k: args.k, questions: golden.length, no_answer: noAns, rows }, null, 2) + "\n");
  console.log(`결과 저장: ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
