// Worker 네트워크 격리 검증. 대조군이 외부에 닿는지 먼저 본 뒤, worker와 같은 조건의 프로브로 차단·허용을 확인한다.
// 실행: node apps/worker/scripts/verify-egress.mjs (docker 데몬 필요). 종료 코드 0=통과, 1=격리 실패, 2=대조 실패·게이트웨이 미확인(판정 무효).
import { bringUpDependencies, composeCapture, createVerifyEnv, dockerOutput, tearDown } from "./compose-env.mjs";

const PROJECT = "knowflow-verify-egress";
const env = createVerifyEnv(PROJECT, 54338);

function runProbe(service, extraEnv = {}) {
  const r = composeCapture({ ...env, ...extraEnv }, ["--profile", "verify", "run", "--rm", "--no-deps", "-T", service]);
  process.stdout.write(r.stdout);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  return r.status;
}

function networkGateway(name) {
  const json = dockerOutput(["network", "inspect", `${PROJECT}_${name}`, "--format", "{{json .IPAM.Config}}"]);
  return JSON.parse(json).map((c) => c.Gateway).filter(Boolean);
}

// 호스트에 게시된 포트(다른 프로젝트 포함, 이 스택의 127.0.0.1 db 포트 포함)도 게이트웨이 경유로 닿으면 안 된다
function publishedHostPorts() {
  const ports = new Set();
  for (const m of dockerOutput(["ps", "--format", "{{.Ports}}"]).matchAll(/(?:[\d.]+|\[[^\]]*\]):(\d+)->/g)) ports.add(m[1]);
  return [...ports];
}

let code = 0;
try {
  bringUpDependencies(env);

  console.log("\n== 대조: 비격리 프로브 ==");
  const control = runProbe("probe-control");
  if (control !== 0) {
    console.error("대조 실패: 비격리 프로브가 외부에 닿지 못했습니다. 차단 판정은 무효입니다.");
    code = 2;
  } else {
    const internalGateways = networkGateway("worker_internal");
    if (internalGateways.length === 0) {
      console.error("실패: worker_internal 게이트웨이를 찾지 못해 게이트웨이 차단을 검사할 수 없습니다.");
      code = 2;
    } else {
      const gateways = [...internalGateways, ...networkGateway("db_host"), ...networkGateway("egress")];
      const hostPorts = publishedHostPorts();
      console.log(`\n== 격리: worker와 같은 이미지·UID·권한 == (게이트웨이 ${gateways.join(", ")}, 게시 포트 ${hostPorts.length}개 포함)`);
      const isolated = runProbe("probe-isolated", { PROBE_GATEWAYS: gateways.join(","), PROBE_HOST_PORTS: hostPorts.join(",") });
      if (isolated !== 0) code = 1;
    }
  }
} finally {
  tearDown(env);
}
console.log(code === 0 ? "\n격리 검증 통과" : `\n격리 검증 실패(종료 코드 ${code})`);
process.exit(code);
