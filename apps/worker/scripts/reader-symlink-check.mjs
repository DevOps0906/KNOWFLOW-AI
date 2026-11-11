// worker 이미지 안에서 도는 고정 파일 어댑터 경로 탈출 검증. verify-ingest.mjs가 docker run(같은 이미지·UID·읽기 전용 루트)으로 실행한다.
// /scratch(tmpfs)에 픽스처 루트와 루트 밖 파일, 루트 밖을 가리키는 심볼릭 링크를 만들고 dist의 실제 어댑터로 읽어 본다.
// 종료 코드 0=통과, 1=탈출 허용, 2=대조 실패(링크를 못 만들었거나 정상 파일도 못 읽음 → 판정 무효)
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createFixtureSourceReader } from "/app/dist/ingest/source-reader.js";

const root = "/scratch/fixtures";
mkdirSync(`${root}/u/p`, { recursive: true });
writeFileSync(`${root}/u/p/a.pdf`, "%PDF-ok");
writeFileSync("/scratch/outside.pdf", "secret");
let code = 0;
try {
  symlinkSync("/scratch/outside.pdf", `${root}/u/p/file-link.pdf`);
  symlinkSync("/scratch", `${root}/u/dir-link`);
} catch (e) {
  console.log(`대조 실패 심볼릭 링크 생성 (${e.code})`);
  process.exit(2);
}
const reader = createFixtureSourceReader(root);
try {
  const ok = Buffer.from(await reader.read("u/p/a.pdf")).toString();
  console.log(`${ok === "%PDF-ok" ? "대조 통과" : "대조 실패"} 루트 안 정상 파일 읽기`);
  if (ok !== "%PDF-ok") code = 2;
} catch (e) {
  console.log(`대조 실패 루트 안 정상 파일 읽기 (${e.code ?? e.name})`);
  process.exit(2);
}
for (const p of ["u/p/file-link.pdf", "u/dir-link/outside.pdf", "../outside.pdf"]) {
  const r = await reader.read(p).then(
    (b) => `읽힘(${b.length}바이트)`,
    (e) => e.code ?? e.name,
  );
  const pass = r === "source_path_invalid";
  console.log(`${pass ? "통과" : "실패"} 탈출 차단 ${p} (${r})`);
  if (!pass && code === 0) code = 1;
}
process.exit(code);
