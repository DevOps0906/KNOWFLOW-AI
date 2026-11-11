// PDF 파서 격리 검증(task-011 구현 결정 3). worker 이미지·UID·권한·망 그대로 컨테이너를 띄우고
// 그 안에서 parser-sandbox-check.mjs가 격리 하위 프로세스의 /proc environ 읽기·db·egress-proxy TCP·DNS 탈출을 실제로 시도한다.
// 실행: node apps/worker/scripts/verify-parser-sandbox.mjs (docker 데몬 필요). 종료 코드 0=통과, 1=격리 실패, 2=대조 실패(판정 무효).
import path from "node:path";
import { bringUpDependencies, composeCapture, createVerifyEnv, repoRoot, tearDown } from "./compose-env.mjs";

const env = createVerifyEnv("knowflow-verify-parser-sandbox", 54340);
const scripts = path.join(repoRoot, "apps/worker/scripts");

let code = 2;
try {
  bringUpDependencies(env);
  const r = composeCapture(env, ["run", "--rm", "--no-deps", "-T", "-v", `${scripts}:/probe:ro`, "--entrypoint", "node", "worker", "/probe/parser-sandbox-check.mjs"]);
  process.stdout.write(r.stdout);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  code = r.status === 0 ? 0 : r.status === 1 ? 1 : 2;
} finally {
  tearDown(env);
}
console.log(code === 0 ? "\n파서 격리 검증 통과" : `\n파서 격리 검증 실패(종료 코드 ${code})`);
process.exit(code);
