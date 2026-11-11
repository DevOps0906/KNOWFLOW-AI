// 빌드 산출물의 키 검사. web 운영 빌드와 Worker 이미지를 직접 만든 뒤 그 파일시스템과 apps/web/.next에서 비밀 패턴을 찾는다
// (secscan은 .next를 건너뛴다). 일치한 값은 출력하지 않고 위치와 종류만 보여 준다.
// 추가 검사할 실제 값은 VERIFY_SECRET_VALUES(쉼표 구분) 환경 변수로 줄 수 있다.
// 실행: node apps/worker/scripts/verify-secrets.mjs. 종료 코드 0=없음, 1=발견, 2=검사 불가.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compose, createVerifyEnv, repoRoot } from "./compose-env.mjs";

const IMAGE = "knowflow-worker:local";
// 이 크기를 넘는 파일은 건너뛰지 않고 실패로 보고한다(.next 캐시의 .sst까지 읽을 수 있는 값)
const MAX_FILE_BYTES = 400 * 1024 * 1024;

const PATTERNS = [
  ["Supabase 비밀 키", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["Anthropic 키", /sk-ant-[A-Za-z0-9_-]{16,}/],
  ["Google API 키", /AIza[0-9A-Za-z_-]{35}/],
  ["DB 연결 문자열(비밀번호 포함)", /postgres(?:ql)?:\/\/[A-Za-z0-9_.-]+:(?!password@|pass@|pw@|p@|secret@|postgres@)[^@\s"'`$<{]{6,}@[A-Za-z0-9_.-]+/],
  ["service_role 환경 변수 값", /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']?eyJ/],
];

const extraValues = (process.env.VERIFY_SECRET_VALUES ?? "").split(",").filter(Boolean);
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

// JWT는 anon 키가 번들에 들어가는 것이 정상이므로 role이 service_role인 것만 잡는다
function hasServiceRoleJwt(text) {
  for (const m of text.matchAll(JWT)) {
    try {
      if (JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).role === "service_role") return true;
    } catch {
      // JWT처럼 보이는 다른 문자열
    }
  }
  return false;
}

const DB_URL_PATTERN = "DB 연결 문자열(비밀번호 포함)";
const THIRD_PARTY_DOC = /node_modules[\\/].*\.(?:md|markdown)$/i;

// 서드파티 패키지 문서의 연결 문자열 예시(pg-connection-string README 등)는 비밀이 아니다
function scanText(text, file = "") {
  const hits = PATTERNS.filter(([name, re]) => re.test(text) && !(name === DB_URL_PATTERN && THIRD_PARTY_DOC.test(file))).map(([name]) => name);
  if (hasServiceRoleJwt(text)) hits.push("service_role JWT");
  if (extraValues.some((v) => text.includes(v))) hits.push("지정한 비밀 값");
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

function scanTree(root) {
  const findings = [];
  let files = 0;
  for (const file of walk(root)) {
    if (statSync(file).size > MAX_FILE_BYTES) {
      findings.push({ file: path.relative(root, file), hits: ["크기 초과로 검사하지 못함"] });
      continue;
    }
    files++;
    const hits = scanText(readFileSync(file, "latin1"), file);
    if (hits.length > 0) findings.push({ file: path.relative(root, file), hits });
  }
  return { findings, files };
}

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

// 지금 소스로 만든 산출물만 검사한다(남아 있는 옛 빌드로 통과하지 않게 한다)
function buildArtifacts() {
  const web = spawnSync("pnpm --filter web build", { cwd: repoRoot, stdio: "inherit", shell: true });
  if (web.status !== 0) {
    console.log(`검사 불가 [웹 번들] 운영 빌드 실패(exit ${web.status})`);
    return false;
  }
  try {
    compose(createVerifyEnv("knowflow-verify-secrets", 54339), ["build", "worker"]);
    return true;
  } catch (e) {
    console.log(`검사 불가 [Worker 이미지] ${e.message}`);
    return false;
  }
}

// 파일이 하나도 없으면 "발견 0건"이 아니라 검사하지 못한 것이다
function report(name, { findings, files }) {
  if (files === 0) {
    console.log(`검사 불가 [${name}] 검사한 파일이 없습니다`);
    return null;
  }
  for (const f of findings) console.log(`실패 [${name}] ${f.file}: ${f.hits.join(", ")}`);
  console.log(`${findings.length === 0 ? "통과" : "실패"} [${name}] 파일 ${files}개 검사, 발견 ${findings.length}건`);
  return findings.length === 0;
}

// Windows에서 나오는 심볼릭 링크 복원 오류와 그 뒤에 붙는 tar의 종료 안내만 무시한다
const TAR_IGNORED = /Cannot create symlink to|Exiting with failure status due to previous errors/;

function tarErrors(stderr) {
  return stderr.split(/\r?\n/).filter((line) => line.trim() !== "" && !TAR_IGNORED.test(line));
}

function scanImage() {
  const work = mkdtempSync(path.join(os.tmpdir(), "kf-image-scan-"));
  const containerId = docker(["create", IMAGE]).stdout.trim();
  try {
    // 이미지 전체를 내려받아 검사한다. 쓰기 가능 경로에 비밀이 구워졌을 때를 포함한다.
    const tarPath = path.join(work, "fs.tar");
    if (docker(["export", "-o", tarPath, containerId]).status !== 0) throw new Error("docker export 실패");
    const root = path.join(work, "fs");
    mkdirSync(root);
    // 베이스 이미지의 시스템 디렉터리만 뺀다(--anchored: /app/node_modules/*/lib 같은 경로는 제외되지 않게 한다)
    const excludes = ["usr/lib", "usr/share", "usr/bin", "usr/sbin", "usr/local/bin", "usr/local/include", "usr/local/lib/node_modules", "lib", "lib64", "bin", "sbin", "proc", "sys", "dev"].flatMap((e) => ["--exclude", e]);
    // Windows의 GNU tar가 드라이브 문자 경로를 못 읽으므로 상대 경로로 푼다
    const tar = spawnSync("tar", ["--anchored", ...excludes, "-xf", "../fs.tar"], { cwd: root, encoding: "utf8" });
    // Windows에서는 심볼릭 링크 복원 오류로 0이 아닌 코드가 나올 수 있어 그 오류만 허용한다
    const tarFailures = tarErrors(tar.stderr ?? "");
    if (tarFailures.length > 0 || !existsSync(path.join(root, "app/dist/main.js"))) {
      console.log(`검사 불가 [Worker 이미지] 압축 해제 실패(exit ${tar.status}, 오류 ${tarFailures.length}줄): ${tarFailures.slice(0, 5).join(" | ")}`);
      return null;
    }

    const ok = report("Worker 이미지", scanTree(root));
    if (ok === null) return null;
    const env = docker(["inspect", IMAGE, "--format", "{{json .Config.Env}}"]).stdout;
    const history = docker(["history", "--no-trunc", "--format", "{{.CreatedBy}}", IMAGE]).stdout;
    const metaHits = scanText(`${env}\n${history}`);
    const namedSecret = /(?:PASSWORD|SERVICE_ROLE|API_KEY|SECRET)[A-Z_]*=/.test(`${env}\n${history}`);
    const metaOk = metaHits.length === 0 && !namedSecret;
    console.log(`${metaOk ? "통과" : "실패"} [Worker 이미지 메타] Env·빌드 이력에 비밀 값·비밀 변수 없음${metaOk ? "" : `: ${metaHits.join(", ")}`}`);
    return ok && metaOk;
  } finally {
    docker(["rm", containerId]);
    rmSync(work, { recursive: true, force: true });
  }
}

function scanWebBundle() {
  const nextDir = path.join(repoRoot, "apps/web/.next");
  if (!existsSync(path.join(nextDir, "BUILD_ID"))) {
    console.log("검사 불가 [웹 번들] apps/web/.next/BUILD_ID가 없습니다(운영 빌드 산출물이 아닙니다).");
    return null;
  }
  return report("웹 번들 .next", scanTree(nextDir));
}

if (!buildArtifacts()) process.exit(2);
const results = [scanImage(), scanWebBundle()];
if (results.includes(false)) process.exit(1);
if (results.includes(null)) process.exit(2);
console.log("\n키 검사 통과");
