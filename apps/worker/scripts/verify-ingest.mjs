// task-011 종단 검증: compose의 worker(실제 핸들러·고정 파일 어댑터·스텁 요약)가 PDF 자료를 queued→completed로 처리하는지 확인한다.
// 확인: 청크 locator.page, projects.summary·suggested_questions, usage_events, 같은 자료 재처리 시 청크 중복 없음, 로그에 본문 없음.
// 실행: node apps/worker/scripts/verify-ingest.mjs (docker 데몬 필요). 픽스처: apps/worker/fixtures/sample/knowflow-sample.pdf
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bringUpDependencies, compose, composeCapture, createVerifyEnv, repoRoot, tearDown } from "./compose-env.mjs";

const env = { ...createVerifyEnv("knowflow-verify-ingest", 54341), WORKER_DUMMY_HANDLERS: "0", WORKER_SOURCE_READER: "fixture", WORKER_SUMMARY_PROVIDER: "stub" };
const STORAGE_PATH = "sample/knowflow-sample.pdf";
const hash = createHash("sha256").update(readFileSync(path.join(repoRoot, "apps/worker/fixtures", STORAGE_PATH))).digest("hex");

function psql(sql) {
  const r = composeCapture(env, ["exec", "-T", "db", "psql", "-U", "postgres", "-d", "knowflow", "-X", "-At", "-v", "ON_ERROR_STOP=1"], sql);
  if (r.status !== 0) throw new Error(`psql 실패: ${r.stderr}`);
  return r.stdout.trim();
}

const SEED = `
with u as (insert into auth.users (email) values ('ingest-' || gen_random_uuid() || '@example.test') returning id),
     p as (insert into public.projects (user_id, name) select id, '종단 검증' from u returning id, user_id),
     s as (insert into public.sources (project_id, user_id, source_type, title, storage_path, content_hash)
           select id, user_id, 'pdf', '샘플 PDF', '${STORAGE_PATH}', '${hash}' from p returning id, user_id),
     j as (insert into public.processing_jobs (user_id, source_id, job_type) select user_id, id, 'source_ingest' from s returning id, source_id)
select id || '|' || source_id from j;`;

async function waitForJob(jobId) {
  for (let i = 0; i < 120; i++) {
    const status = psql(`select status from public.processing_jobs where id = '${jobId}'`);
    if (status === "succeeded" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "timeout";
}

let ok = true;
function check(pass, label, detail = "") {
  console.log(`${pass ? "통과" : "실패"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
}

const chunkStats = (sourceId) =>
  psql(`select count(*) || '|' || count(distinct chunk_index) || '|' || count(*) filter (where (locator ->> 'page') ~ '^[0-9]+$')
               || '|' || coalesce(string_agg(distinct locator ->> 'page', ',' order by locator ->> 'page'), '')
               || '|' || count(*) filter (where embedding_model is not null)
          from public.source_chunks where source_id = '${sourceId}'`).split("|");

try {
  bringUpDependencies(env);
  const [jobId, sourceId] = psql(SEED).split("|");
  const attached = spawn("docker", ["compose", "up", "--no-build", "worker"], { cwd: repoRoot, env, stdio: "ignore" });

  const status = await waitForJob(jobId);
  const err = psql(`select coalesce(error_code, '') from public.processing_jobs where id = '${jobId}'`);
  check(status === "succeeded", "[종단] queued→succeeded", `status=${status}${err ? `, error_code=${err}` : ""}`);
  check(psql(`select status from public.sources where id = '${sourceId}'`) === "completed", "[종단] sources.status=completed");

  const [n, distinct, withPage, pages, withModel] = chunkStats(sourceId);
  check(Number(n) > 0 && n === withPage, "[청크] 모든 청크에 locator.page", `청크 ${n}개, page 있음 ${withPage}개, 쪽 ${pages}`);
  check(pages === "1,2,3", "[청크] 텍스트 쪽(1~3)만 색인, 스캔 쪽(4) 건너뜀", `쪽 ${pages}`);
  check(n === distinct, "[청크] chunk_index 중복 없음");
  check(withModel === "0", "[청크] embedding_model은 벡터 저장 전이라 NULL");
  check(psql(`select count(*) from public.source_chunks where source_id = '${sourceId}' and content_tsv <> ''::tsvector`) === n, "[색인] content_tsv 생성");

  // 요약은 완료 뒤 후행 단계라 조금 늦을 수 있다
  let summary = "";
  for (let i = 0; i < 20 && !summary; i++) {
    summary = psql(`select coalesce(summary, '') || '|' || jsonb_array_length(suggested_questions) from public.projects p
                     join public.sources s on s.project_id = p.id where s.id = '${sourceId}' and p.summary is not null`);
    if (!summary) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const [summaryText = "", questions = "0"] = summary.split("|");
  check(summaryText.length > 0 && Number(questions) >= 1, "[요약] projects.summary·suggested_questions 채워짐(스텁)", `질문 ${questions}개`);
  check(
    psql(`select count(*) from public.usage_events e join public.sources s on s.project_id = e.project_id
           where s.id = '${sourceId}' and e.event_type = 'project_summary' and e.provider = 'stub'`) === "1",
    "[사용 기록] usage_events(project_summary, stub) 1건",
  );

  // 재처리: 같은 자료에 새 작업 → 청크 수가 같고 중복 없음
  const job2 = psql(`with j as (insert into public.processing_jobs (user_id, source_id, job_type)
                     select user_id, id, 'source_ingest' from public.sources where id = '${sourceId}' returning id) select id from j`);
  const status2 = await waitForJob(job2);
  const [n2, distinct2] = chunkStats(sourceId);
  check(status2 === "succeeded" && n2 === n && distinct2 === n, "[재처리] 청크 중복 없음", `처음 ${n}개 → 재처리 ${n2}개`);

  // 고정 파일 어댑터의 심볼릭 링크 탈출 차단을 worker 이미지(리눅스·node UID·읽기 전용 루트) 안에서 실제로 확인한다
  const sym = spawnSync(
    "docker",
    ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--tmpfs", "/scratch:uid=1000,gid=1000", "-v", `${path.join(repoRoot, "apps/worker/scripts")}:/probe:ro`,
      "--entrypoint", "node", "knowflow-worker:local", "/probe/reader-symlink-check.mjs"],
    { encoding: "utf8" },
  );
  process.stdout.write(sym.stdout ?? "");
  check(sym.status === 0, "[원본 읽기] 심볼릭 링크 경로 탈출 차단(worker 이미지 안)", `exit ${sym.status}`);

  compose(env, ["stop", "worker"]);
  if (attached.exitCode === null && attached.signalCode === null) await new Promise((resolve) => attached.once("exit", resolve));
  const logs = composeCapture(env, ["logs", "--no-log-prefix", "worker"]);
  console.log(logs.stdout.split("\n").filter((l) => /job_finished|source_extracted|after_complete/.test(l)).join("\n"));
  // 로그를 못 읽었으면 아래 "없음" 판정이 거짓 통과가 되므로 실패로 본다
  check(logs.status === 0 && logs.stdout.includes("job_finished"), "[로그] worker 로그 수집", `exit ${logs.status}`);
  const all = logs.stdout + logs.stderr;
  check(!/청킹은 쪽 경계|KnowFlow 샘플 자료|출처는 쪽 번호/.test(all), "[로그] 청크 본문 없음");
  check(![env.KF_DB_SUPERUSER_PASSWORD, env.WORKER_DB_PASSWORD].some((s) => all.includes(s)), "[로그] DB 비밀번호 없음");
} finally {
  tearDown(env);
}
console.log(ok ? "\n자료 처리 종단 검증 통과" : "\n자료 처리 종단 검증 실패");
process.exit(ok ? 0 : 1);
