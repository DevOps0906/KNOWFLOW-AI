// Supabase Storage 원본 읽기 실검증: 실제 로컬 Supabase에 서비스 키로 sources/verify-<rand>/a.pdf를 올리고
// 빌드된 리더(dist)로 정상·객체 없음(영구)·잘못된 키(재시도)·상한 초과(영구) 4가지를 확인한 뒤 객체를 지운다.
// 실행: pnpm build && node --env-file=.env.local scripts/verify-storage.mjs [--allow-remote] (env: SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY)
// SUPABASE_URL이 loopback이 아니면 --allow-remote 없이는 멈춘다. URL·키 값은 출력하지 않는다.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSupabaseUrl } from "../dist/config.js";
import { createStorageSourceReader } from "../dist/ingest/source-reader.js";
import { INGEST_ERROR_CODES } from "../dist/ingest/settings.js";
import { PermanentError } from "../dist/runner.js";

// 처리되지 않은 예외는 메시지·스택에 헤더 값이 섞일 수 있으므로 고정 문구만 남긴다
process.on("uncaughtException", () => {
  console.error("검증 중 예기치 않은 오류(상세는 출력하지 않음)");
  process.exit(1);
});
process.on("unhandledRejection", () => {
  console.error("검증 중 예기치 않은 오류(상세는 출력하지 않음)");
  process.exit(1);
});

function isLoopback(base) {
  const host = new URL(base).hostname.toLowerCase();
  return host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!process.env.SUPABASE_URL) {
    console.error("SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다");
    return 2;
  }
  // 헤더에 그대로 실리므로 config.ts와 같은 규칙(출력 가능한 ASCII)으로 검사한다. 값은 메시지에 넣지 않는다.
  if (!/^[\x21-\x7e]{1,4096}$/.test(key)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY 형식이 올바르지 않습니다");
    return 2;
  }
  let url;
  try {
    url = parseSupabaseUrl(process.env.SUPABASE_URL);
  } catch {
    console.error("SUPABASE_URL 형식이 올바르지 않습니다");
    return 2;
  }
  if (!isLoopback(url) && !process.argv.includes("--allow-remote")) {
    console.error("SUPABASE_URL이 로컬(loopback)이 아닙니다. 원격에 쓰려면 --allow-remote를 붙이세요");
    return 2;
  }
  const pdf = new Uint8Array(readFileSync(path.join(here, "../fixtures/sample/knowflow-sample.pdf")));
  const dir = `verify-${randomBytes(6).toString("hex")}`;
  const objectPath = `${dir}/a.pdf`;
  const objectUrl = `${url}/storage/v1/object/sources/${objectPath}`;
  const auth = { Authorization: `Bearer ${key}`, apikey: key };

  let ok = true;
  function check(pass, label, detail = "") {
    console.log(`${pass ? "통과" : "실패"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!pass) ok = false;
  }

  /** 결과를 {kind, code}로 요약한다(오류 메시지는 고정 코드라 출력해도 값이 새지 않는다) */
  async function outcome(p) {
    try {
      const bytes = await p;
      return { kind: "ok", bytes };
    } catch (e) {
      if (e instanceof PermanentError) return { kind: "permanent", code: e.code };
      return { kind: "retry", code: e instanceof Error ? e.message : "unknown" };
    }
  }

  const up = await fetch(objectUrl, {
    method: "POST",
    redirect: "error",
    headers: { ...auth, "content-type": "application/pdf", "x-upsert": "false" },
    body: pdf,
  });
  await up.body?.cancel();
  if (up.status !== 200) {
    console.error(`업로드 실패: HTTP ${up.status}`);
    return 1;
  }
  try {
    const reader = createStorageSourceReader({ url, serviceRoleKey: key });

    const normal = await outcome(reader.read(objectPath));
    check(
      normal.kind === "ok" && normal.bytes.byteLength === pdf.byteLength && Buffer.compare(Buffer.from(normal.bytes), Buffer.from(pdf)) === 0,
      "정상: 올린 바이트와 같은 내용을 읽는다",
      normal.kind === "ok" ? `${normal.bytes.byteLength}B` : `${normal.kind}:${normal.code}`,
    );

    const missing = await outcome(reader.read(`${dir}/missing.pdf`));
    check(missing.kind === "permanent" && missing.code === INGEST_ERROR_CODES.sourceObjectMissing, "없음: 영구 실패 source_object_missing", `${missing.kind}:${missing.code ?? ""}`);

    const badKey = await outcome(createStorageSourceReader({ url, serviceRoleKey: "invalid-service-key" }).read(objectPath));
    check(badKey.kind === "retry", "잘못된 키: 재시도(영구 실패 아님)", `${badKey.kind}:${badKey.code ?? ""}`);

    const tooLarge = await outcome(createStorageSourceReader({ url, serviceRoleKey: key, maxBytes: pdf.byteLength - 1 }).read(objectPath));
    check(tooLarge.kind === "permanent" && tooLarge.code === INGEST_ERROR_CODES.sourceTooLarge, "상한 초과: 영구 실패 source_too_large", `${tooLarge.kind}:${tooLarge.code ?? ""}`);
  } finally {
    const del = await fetch(`${url}/storage/v1/object/sources`, {
      method: "DELETE",
      redirect: "error",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [objectPath] }),
    });
    await del.body?.cancel();
    check(del.status === 200, "정리: 검증 객체 삭제", `HTTP ${del.status}`);
  }
  return ok ? 0 : 1;
}

try {
  process.exit(await main());
} catch {
  console.error("검증 중 예기치 않은 오류(상세는 출력하지 않음)");
  process.exit(1);
}
