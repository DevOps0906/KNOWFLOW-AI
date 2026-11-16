// 03_storage_copy.mjs 단위 검사(네트워크 없음, fetch 대역). check.sh가 부른다: node check_storage_copy.mjs [실제 map 파일]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMap, run, storageOrigin } from "./03_storage_copy.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const line = (f) => `${A}/${P}/${f}\t${O}/${P}/${f}`;
const quiet = () => {};

// 형식
assert.equal(parseMap(`${line("a.pdf")}\n\n${line("b.pdf")}\n`).length, 2);
assert.throws(() => parseMap(`${A}/${P}/a.pdf`), /map_invalid/);
assert.throws(() => parseMap(`${A}/${P}/a.pdf\t${O}/${P}/other.pdf`), /뒷부분/);
assert.throws(() => parseMap(`../${P}/a.pdf\t${O}/${P}/a.pdf`), /map_invalid/);

// URL 제한
assert.equal(storageOrigin("https://x.supabase.co/rest"), "https://x.supabase.co");
assert.equal(storageOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
assert.throws(() => storageOrigin("http://evil.example.com"), /env_invalid/);

// dry-run은 요청하지 않는다
let calls = [];
const fake = async (url, init) => {
  calls.push({ url, init });
  const key = JSON.parse(init.body).destinationKey;
  if (key.endsWith("dup.pdf")) return new Response('{"statusCode":"409","error":"Duplicate"}', { status: 400 });
  if (key.endsWith("bad.pdf")) return new Response("boom", { status: 500 });
  return new Response('{"Key":"ok"}', { status: 200 });
};
const map = [line("a.pdf"), line("dup.pdf"), line("bad.pdf")].join("\n");
let r = await run({ mapText: map, apply: false, env: {}, fetchImpl: fake, log: quiet });
assert.deepEqual(r, { planned: 3, copied: 0, skipped: 0, failed: 0 });
assert.equal(calls.length, 0);

// apply: env 필수
await assert.rejects(run({ mapText: map, apply: true, env: {}, fetchImpl: fake, log: quiet }), /env_missing/);

// apply: 요청 형식 · 409 건너뜀 · 실패 집계
r = await run({ mapText: map, apply: true, env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key" }, fetchImpl: fake, log: quiet });
assert.deepEqual(r, { planned: 3, copied: 1, skipped: 1, failed: 1 });
assert.equal(calls[0].url, "https://x.supabase.co/storage/v1/object/copy");
assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
assert.deepEqual(JSON.parse(calls[0].init.body),
  { bucketId: "sources", sourceKey: `${A}/${P}/a.pdf`, destinationBucket: "knowflow-sources", destinationKey: `${O}/${P}/a.pdf` });

// 실제 이관 DB에서 뽑은 목록도 형식 통과(dry-run)
if (process.argv[2]) {
  r = await run({ mapText: readFileSync(process.argv[2], "utf8"), apply: false, env: {}, log: quiet });
  console.log(`check_storage_copy: OK (map ${r.planned}건 dry-run)`);
} else {
  console.log("check_storage_copy: OK");
}
