// worker 컨테이너 안에서 도는 파서 격리 검증. verify-parser-sandbox.mjs가 compose run으로 실행한다.
// 대조(격리 안 한 부모): db·egress-proxy TCP, 내부 DNS, /proc environ 읽기가 되어야 한다(안 되면 판정 무효, 종료 2).
// 격리(dist/pdf/sandbox.js의 runSandboxed): 같은 시도가 모두 권한 거부되고 환경 변수가 비어야 한다(아니면 종료 1).
// 마지막으로 이미지 안의 실제 파서(dist/pdf/parser.js)가 격리 상태에서 PDF를 읽는지 확인한다.
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import net from "node:net";
import { parsePdf, sha256Hex } from "/app/dist/pdf/parser.js";
import { runSandboxed } from "/app/dist/pdf/sandbox.js";

const PROBE = "/probe/parser-sandbox-probe.mjs";
const TCP = [["db", 5432], ["egress-proxy", 8888], ["embedding-stub", 8080]];
const FILES = ["/proc/1/environ", "/proc/self/environ", "/app/package.json"];
const DENIED = "ERR_ACCESS_DENIED";
let failed = false;
let invalid = false;

function check(ok, label, detail = "") {
  console.log(`${ok ? "통과" : "실패"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
}

function control(ok, label, detail = "") {
  console.log(`${ok ? "대조 통과" : "대조 실패"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) invalid = true;
}

function tcp(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2500 });
    const done = (r) => {
      s.destroy();
      resolve(r);
    };
    s.once("connect", () => done("ok"));
    s.once("timeout", () => done("timeout"));
    s.once("error", (e) => done(e.code ?? e.name));
  });
}

// 텍스트 1쪽짜리 최소 PDF(표준 글꼴 Helvetica)
function samplePdf(text) {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

console.log(`Node ${process.version}, uid ${process.getuid?.()}`);

console.log("\n== 대조: 격리하지 않은 부모 ==");
for (const [host, port] of TCP) control((await tcp(host, port)) === "ok", `TCP ${host}:${port} 연결`);
control(await dns.lookup("db").then(() => true, () => false), "내부 DNS db 조회");
control(readFileSync("/proc/self/environ", "latin1").includes("DATABASE_URL="), "/proc/self/environ에 DATABASE_URL 있음");
control(readFileSync("/proc/1/environ", "latin1").includes("DATABASE_URL="), "/proc/1/environ에 DATABASE_URL 있음");

console.log("\n== 격리: runSandboxed 하위 프로세스 ==");
const targets = {
  files: FILES,
  tcp: TCP,
  dns: ["example.com", "db"],
  udp: [["8.8.8.8", 53], ["db", 5432]],
  fetch: ["http://egress-proxy:8888/", "https://example.com/"],
};
const r = JSON.parse(
  await runSandboxed(PROBE, new Uint8Array(), {
    readPaths: [],
    args: ["probe", JSON.stringify(targets)],
    timeoutMs: 30_000,
    maxOldSpaceMb: 64,
    maxOutputBytes: 1024 * 1024,
  }),
);
check(r.envKeys.length === 0, "환경 변수 비어 있음", r.envKeys.join(","));
for (const [k, v] of Object.entries(r.files)) check(v === DENIED, `파일 읽기 거부 ${k}`, v);
for (const [k, v] of Object.entries(r.tcp)) check(v === DENIED, `TCP 거부 ${k}`, v);
for (const [k, v] of Object.entries(r.dns)) check(v === DENIED, `DNS 거부 ${k}`, v);
for (const [k, v] of Object.entries(r.udp)) check(v === DENIED, `UDP 거부 ${k}`, v);
for (const [k, v] of Object.entries(r.fetch)) check(v !== "ok", `fetch 실패 ${k}`, v);
for (const [k, v] of Object.entries(r.codegen)) check(v === "EvalError", `코드 생성 거부 ${k}`, v);

console.log("\n== 격리 상태의 실제 파서 ==");
const pdf = samplePdf("KnowFlow parser sandbox check 2026");
try {
  const parsed = await parsePdf(pdf, sha256Hex(pdf));
  check(parsed.pageCount === 1 && parsed.pages[0]?.text.includes("KnowFlow parser sandbox check 2026"), "PDF 1쪽 텍스트 추출");
} catch (e) {
  check(false, "PDF 1쪽 텍스트 추출", e?.code ?? e?.name);
}

const code = invalid ? 2 : failed ? 1 : 0;
console.log(code === 0 ? "\n파서 격리 검증 통과" : `\n파서 격리 검증 실패(종료 코드 ${code})`);
process.exit(code);
