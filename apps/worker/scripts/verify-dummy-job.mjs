// compose의 worker가 더미 작업을 succeeded로 전이시키는지, 잘못된 DB 신원이면 기동을 거부하는지 확인한다.
// 실행: node apps/worker/scripts/verify-dummy-job.mjs (docker 데몬 필요).
import { spawn } from "node:child_process";
import { compose, bringUpDependencies, composeCapture, createVerifyEnv, repoRoot, tearDown } from "./compose-env.mjs";

// 이 검증은 더미 핸들러로 상태 전이만 본다(실제 처리 종단은 verify-ingest.mjs)
const env = { ...createVerifyEnv("knowflow-verify-job", 54337), WORKER_DUMMY_HANDLERS: "1" };

function psql(sql) {
  const r = composeCapture(env, ["exec", "-T", "db", "psql", "-U", "postgres", "-d", "knowflow", "-X", "-At", "-v", "ON_ERROR_STOP=1"], sql);
  if (r.status !== 0) throw new Error(`psql 실패: ${r.stderr}`);
  return r.stdout.trim();
}

const SEED = `
with u as (insert into auth.users (email) values ('verify-' || gen_random_uuid() || '@example.test') returning id),
     p as (insert into public.projects (user_id, name) select id, '검증' from u returning id, user_id),
     s as (insert into public.sources (project_id, user_id, source_type, title, original_url)
           select id, user_id, 'url', '검증', 'https://example.test/a' from p returning id, user_id),
     j as (insert into public.processing_jobs (user_id, source_id, job_type) select user_id, id, 'source_ingest' from s returning id)
select id from j;`;

function expectRefused(name, envOverride, reason) {
  const args = ["run", "--rm", "--no-deps", "-T"];
  for (const [k, v] of Object.entries(envOverride)) args.push("-e", `${k}=${v}`);
  const r = composeCapture(env, [...args, "worker"]);
  const passed = r.status !== 0 && r.stdout.includes(reason);
  console.log(`${passed ? "통과" : "실패"} [기동 거부] ${name} — exit ${r.status}, 기대 사유 ${reason}`);
  if (!passed) process.stdout.write(r.stdout);
  return passed;
}

async function waitForStatus(jobId) {
  for (let i = 0; i < 60; i++) {
    const status = psql(`select status from public.processing_jobs where id = '${jobId}'`);
    if (status === "succeeded" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "timeout";
}

let ok = true;
try {
  bringUpDependencies(env);
  const jobId = psql(SEED);
  // 완료 조건 그대로 attached `docker compose up worker`로 띄운다
  const attached = spawn("docker", ["compose", "up", "--no-build", "worker"], { cwd: repoRoot, env, stdio: "ignore" });
  const status = await waitForStatus(jobId);
  const attempts = psql(`select attempt_count from public.processing_jobs where id = '${jobId}'`);
  const sourceStatus = psql(`select s.status from public.sources s join public.processing_jobs j on j.source_id = s.id where j.id = '${jobId}'`);
  console.log(`${status === "succeeded" ? "통과" : "실패"} [더미 작업] status=${status}, attempt_count=${attempts}, source=${sourceStatus}`);
  ok = status === "succeeded";

  // SIGTERM 정상 종료 확인(stop_grace_period 안에 끝나야 한다)
  compose(env, ["stop", "worker"]);
  // 이미 끝난 프로세스에는 exit가 다시 오지 않으므로 기다리지 않는다
  if (attached.exitCode === null && attached.signalCode === null) await new Promise((resolve) => attached.once("exit", resolve));

  const logs = composeCapture(env, ["logs", "--no-log-prefix", "worker"]);
  console.log(logs.stdout.split("\n").filter((l) => /worker_started|job_claimed|job_finished|worker_stopped/.test(l)).join("\n"));
  if (!logs.stdout.includes("worker_stopped")) {
    console.log("실패 [정상 종료] worker_stopped 로그가 없습니다");
    ok = false;
  }
  for (const secret of [env.KF_DB_SUPERUSER_PASSWORD, env.WORKER_DB_PASSWORD]) {
    if (logs.stdout.includes(secret) || logs.stderr.includes(secret)) {
      console.log("실패 [로그] worker 로그에 DB 비밀번호가 있습니다");
      ok = false;
    }
  }

  const superUrl = `postgres://postgres:${env.KF_DB_SUPERUSER_PASSWORD}@db:5432/knowflow`;
  ok = expectRefused("슈퍼유저 접속", { DATABASE_URL: superUrl }, "db_superuser_refused") && ok;

  psql("revoke service_role from knowflow_worker;");
  ok = expectRefused("SET ROLE 불가", {}, "db_set_role_failed") && ok;
  psql("grant service_role to knowflow_worker;");

  const remoteUrl = `postgres://knowflow_worker:${env.WORKER_DB_PASSWORD}@db.example.supabase.co:5432/knowflow`;
  ok = expectRefused("더미 핸들러 + 원격 DB", { DATABASE_URL: remoteUrl }, "더미 핸들러") && ok;
} finally {
  tearDown(env);
}
console.log(ok ? "\n더미 작업 검증 통과" : "\n더미 작업 검증 실패");
process.exit(ok ? 0 : 1);
