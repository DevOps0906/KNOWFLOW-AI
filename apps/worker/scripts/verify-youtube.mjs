// task-027c·028 종단 검증: compose의 worker(실제 핸들러·스텁 영상 분석기·스텁 요약)가 유튜브 자료를 queued→completed로 처리하는지 확인한다.
// 확인: 긴 영상 분할(3구간), 청크 locator t_start/t_end, source_moments, usage_events, 같은 영상 재처리 시 청크·장면 중복 없음,
// 플래그 꺼짐이면 유튜브 작업이 재시도 없이 youtube_disabled로 실패, 로그에 전사 본문·비밀 없음. Gemini 실호출 없음.
// 실행: node apps/worker/scripts/verify-youtube.mjs (docker 데몬 필요)
import { spawn } from "node:child_process";
import { bringUpDependencies, compose, composeCapture, createVerifyEnv, repoRoot, tearDown } from "./compose-env.mjs";

const base = {
  ...createVerifyEnv("knowflow-verify-youtube", 54343),
  WORKER_DUMMY_HANDLERS: "0",
  WORKER_SOURCE_READER: "fixture",
  WORKER_SUMMARY_PROVIDER: "stub",
  YOUTUBE_ANALYZER: "stub",
  // 셸에 키가 있어도 이 검증에는 넘기지 않는다
  GEMINI_API_KEY: "",
};
const env = { ...base, YOUTUBE_ENABLED: "1" };
const VIDEO_ID = "verifyYT_01";
const DURATION = 2500; // 20분 구간 3개(0~1200, 1170~2370, 2340~2500)

function psql(sql) {
  const r = composeCapture(env, ["exec", "-T", "db", "psql", "-U", "postgres", "-d", "knowflow", "-X", "-At", "-v", "ON_ERROR_STOP=1"], sql);
  if (r.status !== 0) throw new Error(`psql 실패: ${r.stderr}`);
  return r.stdout.trim();
}

const SEED = `
with u as (insert into auth.users (email) values ('youtube-' || gen_random_uuid() || '@example.test') returning id),
     p as (insert into public.projects (user_id, name) select id, '유튜브 종단 검증' from u returning id, user_id),
     s as (insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, channel_title, duration_seconds, metadata_checked_at)
           select id, user_id, 'youtube', '검증 영상', 'https://www.youtube.com/watch?v=${VIDEO_ID}', '${VIDEO_ID}', '검증 채널', ${DURATION}, now()
             from p returning id, user_id),
     j as (insert into public.processing_jobs (user_id, source_id, job_type) select user_id, id, 'source_ingest' from s returning id, source_id)
select id || '|' || source_id from j;`;

const enqueue = (sourceId) =>
  psql(`with j as (insert into public.processing_jobs (user_id, source_id, job_type)
         select user_id, id, 'source_ingest' from public.sources where id = '${sourceId}' returning id) select id from j`);

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
  psql(`select count(*) || '|' || count(distinct chunk_index)
               || '|' || count(*) filter (where jsonb_typeof(locator -> 't_start') = 'number' and jsonb_typeof(locator -> 't_end') = 'number'
                                            and (locator ->> 't_start')::numeric >= 0 and (locator ->> 't_end')::numeric <= ${DURATION}
                                            and (locator ->> 't_end')::numeric > (locator ->> 't_start')::numeric and not locator ? 'page')
               || '|' || coalesce(min((locator ->> 't_start')::numeric), -1) || '|' || coalesce(max((locator ->> 't_end')::numeric), -1)
          from public.source_chunks where source_id = '${sourceId}'`).split("|");

const momentStats = (sourceId) =>
  psql(`select count(*) || '|' || count(distinct moment_index) || '|' || count(*) filter (where (locator ->> 't_end')::numeric <= ${DURATION})
          from public.source_moments where source_id = '${sourceId}'`).split("|");

function startWorker(workerEnv) {
  return spawn("docker", ["compose", "up", "--no-build", "worker"], { cwd: repoRoot, env: workerEnv, stdio: "ignore" });
}

async function stopWorker(workerEnv, attached) {
  compose(workerEnv, ["stop", "worker"]);
  if (attached.exitCode === null && attached.signalCode === null) await new Promise((resolve) => attached.once("exit", resolve));
}

let allLogs = "";
function collectLogs(workerEnv) {
  const logs = composeCapture(workerEnv, ["logs", "--no-log-prefix", "worker"]);
  check(logs.status === 0 && logs.stdout.includes("job_finished"), "[로그] worker 로그 수집", `exit ${logs.status}`);
  allLogs += logs.stdout + logs.stderr;
}

try {
  bringUpDependencies(env);
  const [jobId, sourceId] = psql(SEED).split("|");
  let attached = startWorker(env);

  const status = await waitForJob(jobId);
  const err = psql(`select coalesce(error_code, '') from public.processing_jobs where id = '${jobId}'`);
  check(status === "succeeded", "[종단] queued→succeeded", `status=${status}${err ? `, error_code=${err}` : ""}`);
  check(psql(`select status from public.sources where id = '${sourceId}'`) === "completed", "[종단] sources.status=completed");

  const [n, distinct, timed, minT, maxT] = chunkStats(sourceId);
  check(Number(n) > 0 && n === timed, "[청크] 모든 청크 locator에 t_start/t_end(영상 범위 안, page 없음)", `청크 ${n}개, 시각 있음 ${timed}개`);
  check(Number(minT) === 0 && Number(maxT) === DURATION, "[청크] 전사가 영상 처음부터 끝까지 덮음(분할 구간 합침)", `${minT}~${maxT}초`);
  check(n === distinct, "[청크] chunk_index 중복 없음");
  check(psql(`select count(*) from public.source_chunks where source_id = '${sourceId}' and content_tsv <> ''::tsvector`) === n, "[색인] content_tsv 생성");

  const [m, mDistinct, mInRange] = momentStats(sourceId);
  check(m === "3" && mDistinct === "3" && mInRange === "3", "[장면] 구간당 장면 1개씩 3개 저장(영상 범위 안)", `장면 ${m}개`);
  const usage = psql(`select count(*) from public.usage_events e join public.sources s on s.project_id = e.project_id
                       where s.id = '${sourceId}' and e.event_type = 'youtube_analysis' and e.provider = 'stub'`);
  check(usage === "3", "[사용 기록] usage_events(youtube_analysis, stub) 구간 수만큼 3건", `${usage}건`);

  let summary = "";
  for (let i = 0; i < 20 && !summary; i++) {
    summary = psql(`select coalesce(p.summary, '') from public.projects p join public.sources s on s.project_id = p.id where s.id = '${sourceId}'`);
    if (!summary) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(summary.length > 0, "[요약] 첫 자료 요약 저장(스텁)");

  // 재처리: 같은 영상에 새 작업 → 청크·장면 수가 같고 중복 없음
  const job2 = enqueue(sourceId);
  const status2 = await waitForJob(job2);
  const [n2, distinct2] = chunkStats(sourceId);
  const [m2, mDistinct2] = momentStats(sourceId);
  check(status2 === "succeeded" && n2 === n && distinct2 === n, "[재처리] 청크 중복 없음", `처음 ${n}개 → 재처리 ${n2}개`);
  check(m2 === m && mDistinct2 === m, "[재처리] 장면 중복 없음", `처음 ${m}개 → 재처리 ${m2}개`);

  await stopWorker(env, attached);
  collectLogs(env);

  // 플래그 꺼짐: 유튜브 처리를 등록하지 않으므로 들어온 작업은 재시도 없이 영구 실패
  const offEnv = { ...base, YOUTUBE_ENABLED: "0" };
  attached = startWorker(offEnv);
  const job3 = enqueue(sourceId);
  const status3 = await waitForJob(job3);
  const [code3, attempts3] = psql(`select coalesce(error_code, '') || '|' || attempt_count from public.processing_jobs where id = '${job3}'`).split("|");
  check(status3 === "failed" && code3 === "youtube_disabled" && attempts3 === "1", "[플래그 꺼짐] youtube_disabled로 재시도 없이 실패", `status=${status3}, error_code=${code3}, 시도 ${attempts3}`);
  check(chunkStats(sourceId)[0] === n && momentStats(sourceId)[0] === m, "[플래그 꺼짐] 기존 청크·장면은 그대로");
  await stopWorker(offEnv, attached);
  collectLogs(offEnv);

  console.log(allLogs.split("\n").filter((l) => /job_finished|youtube_analyzed|after_complete/.test(l)).join("\n"));
  check(!/스텁 전사|스텁 장면|스텁 분석기가 만든/.test(allLogs), "[로그] 전사·장면 본문 없음");
  check(![env.KF_DB_SUPERUSER_PASSWORD, env.WORKER_DB_PASSWORD].some((s) => allLogs.includes(s)), "[로그] DB 비밀번호 없음");
} finally {
  tearDown(env);
}
console.log(ok ? "\n유튜브 처리 종단 검증 통과" : "\n유튜브 처리 종단 검증 실패");
process.exit(ok ? 0 : 1);
