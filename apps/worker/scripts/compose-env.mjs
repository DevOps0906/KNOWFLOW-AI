// 검증 스크립트 공용: 일반 스택과 겹치지 않는 별도 compose 프로젝트를 쓰고, 비밀번호는 실행마다 새로 만든다(tmpfs DB라 남지 않는다).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function createVerifyEnv(projectName, hostPort) {
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    KF_DB_HOST_PORT: String(hostPort),
    KF_DB_SUPERUSER_PASSWORD: randomBytes(16).toString("hex"),
    WORKER_DB_PASSWORD: randomBytes(16).toString("hex"),
  };
}

/** docker compose를 실행하고 출력을 그대로 보여 준다. 실패하면 예외. */
export function compose(env, args) {
  const r = spawnSync("docker", ["compose", ...args], { cwd: repoRoot, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`docker compose ${args[0]} 실패(exit ${r.status})`);
}

/** docker compose를 실행해 종료 코드와 출력을 돌려준다(화면에 쓰지 않는다). */
export function composeCapture(env, args, input) {
  const r = spawnSync("docker", ["compose", ...args], { cwd: repoRoot, env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function dockerOutput(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

/** 스택을 띄운다: db·프록시·스텁 → migrate 완료까지. worker는 호출자가 띄운다. */
export function bringUpDependencies(env) {
  compose(env, ["build", "worker", "egress-proxy"]);
  compose(env, ["up", "-d", "--wait", "db", "egress-proxy", "embedding-stub"]);
  compose(env, ["up", "--no-log-prefix", "--abort-on-container-exit", "--exit-code-from", "migrate", "migrate"]);
}

export function tearDown(env) {
  compose(env, ["--profile", "verify", "down", "-v", "--remove-orphans"]);
}
