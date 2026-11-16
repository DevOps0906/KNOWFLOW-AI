// KNOWFLOW nomad DB 전환 3단계: 옛 버킷 sources → 새 버킷 knowflow-sources 객체 복사(Storage API copy, 서버 안에서 복사).
// 사용: node supabase/nomad-cutover/03_storage_copy.mjs <storage-map.tsv> [--apply]
//   목록은 03_storage_map.sql 출력("옛 경로<TAB>새 경로"). 기본은 dry-run(요청 없이 계획만 출력).
//   --apply: env SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 필요(키는 env로만 받고 출력하지 않는다).
// 이미 있는 대상(409·Duplicate)은 건너뛴다 → 재실행 안전. 크기 대조는 03_storage_verify.sql이 한다. 옛 객체는 지우지 않는다.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SOURCE_BUCKET = "sources";
export const TARGET_BUCKET = "knowflow-sources";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^${UUID}/${UUID}/[A-Za-z0-9._-]{1,200}$`);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "kong"]);

/** 목록 파싱. 형식이 어긋난 줄이 하나라도 있으면 throw(아무것도 복사하지 않음). */
export function parseMap(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    const parts = line.split("\t");
    if (parts.length !== 2 || !PATH_RE.test(parts[0]) || !PATH_RE.test(parts[1])) {
      throw new Error(`map_invalid: ${i + 1}번째 줄 형식 오류`);
    }
    // 첫 폴더(소유)만 바뀌고 나머지 경로는 같아야 한다(02_copy 규칙)
    if (parts[0].slice(36) !== parts[1].slice(36)) throw new Error(`map_invalid: ${i + 1}번째 줄 경로 뒷부분 불일치`);
    rows.push({ from: parts[0], to: parts[1] });
  });
  return rows;
}

/** SUPABASE_URL 검사: https만, 로컬 호스트는 http 허용. origin만 쓴다. */
export function storageOrigin(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("env_invalid: SUPABASE_URL 형식 오류"); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname))) {
    throw new Error("env_invalid: SUPABASE_URL은 https(로컬만 http)");
  }
  return u.origin;
}

export async function run({ mapText, apply, env, fetchImpl = fetch, log = console.log }) {
  const rows = parseMap(mapText);
  if (!apply) {
    for (const r of rows) log(`plan ${SOURCE_BUCKET}/${r.from} -> ${TARGET_BUCKET}/${r.to}`);
    log(`dry-run: ${rows.length}건 (복사하려면 --apply)`);
    return { planned: rows.length, copied: 0, skipped: 0, failed: 0 };
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) throw new Error("env_missing: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 필요");
  const origin = storageOrigin(env.SUPABASE_URL);
  let copied = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const res = await fetchImpl(`${origin}/storage/v1/object/copy`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ bucketId: SOURCE_BUCKET, sourceKey: r.from, destinationBucket: TARGET_BUCKET, destinationKey: r.to }),
    });
    const body = await res.text();
    if (res.ok) { copied++; continue; }
    if (res.status === 409 || /"statusCode"\s*:\s*"409"|Duplicate|already exists/i.test(body)) { skipped++; continue; }
    failed++;
    log(`fail ${r.to}: HTTP ${res.status}`);
  }
  log(`apply: 복사 ${copied} · 이미 있음 ${skipped} · 실패 ${failed} / ${rows.length}건 — 다음: 03_storage_verify.sql`);
  return { planned: rows.length, copied, skipped, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("사용: node 03_storage_copy.mjs <storage-map.tsv> [--apply]"); process.exit(2); }
  run({ mapText: readFileSync(file, "utf8"), apply: args.includes("--apply"), env: process.env })
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
