import { loadConfig, type WorkerConfig } from "./config.js";
import { createPool, DbIdentityError, verifyDbIdentity } from "./db.js";
import { buildHandlers } from "./handlers.js";
import { log } from "./log.js";
import { createPgQueue } from "./queue.js";
import { backoffMs, runOnce, type RunOutcome } from "./runner.js";

function refuseStart(reason: string, e?: unknown): never {
  log({ event: "startup_refused", reason, errorName: e instanceof Error ? e.name : undefined });
  process.exit(1);
}

let config: WorkerConfig;
try {
  config = loadConfig();
} catch (e) {
  // config의 오류 메시지는 변수 이름만 담는다(값을 넣지 않는다)
  refuseStart(e instanceof Error ? e.message : "config_error", e);
}

const pool = createPool(config, (e) => refuseStart("db_set_role_failed", e));
try {
  await verifyDbIdentity(pool, config.dbRole);
} catch (e) {
  refuseStart(e instanceof DbIdentityError ? e.code : "db_identity_check_failed", e);
}
const queue = createPgQueue(pool);
const handlers = buildHandlers(config, pool, log);

let stopping = false;
let wake: (() => void) | null = null;
const counters = { claimed: 0, succeeded: 0, failed: 0, requeued: 0, stale: 0 };
let windowStart = Date.now();

function record(outcome: RunOutcome) {
  if (outcome === "idle") return;
  counters.claimed++;
  if (outcome === "succeeded") counters.succeeded++;
  else if (outcome === "failed") counters.failed++;
  else if (outcome === "requeued") counters.requeued++;
  else counters.stale++;
}

// 처리량 측정 기록(ADR-0005): 주기적으로 분당 처리 건수를 로그로 남기고 카운터를 비운다
const metrics = setInterval(() => {
  const seconds = Math.max(1, Math.round((Date.now() - windowStart) / 1000));
  log({
    event: "metrics",
    workerId: config.workerId,
    ...counters,
    windowSeconds: seconds,
    jobsPerMinute: Math.round(((counters.succeeded + counters.failed) * 60) / seconds),
  });
  Object.assign(counters, { claimed: 0, succeeded: 0, failed: 0, requeued: 0, stale: 0 });
  windowStart = Date.now();
}, config.metricsIntervalMs);
metrics.unref();

function sleep(ms: number) {
  // 처리 중에 종료 신호를 받았으면 wake가 이미 지나갔으므로 대기에 들어가지 않는다
  if (stopping) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

async function loop() {
  log({ event: "worker_started", workerId: config.workerId });
  // 일시 오류(DB 끊김, 재시도 대기로 돌아간 작업)가 이어지면 폴링 간격을 늘린다
  let transientFailures = 0;
  while (!stopping) {
    try {
      const outcome = await runOnce({
        queue,
        handlers,
        leaseSeconds: config.leaseSeconds,
        heartbeatSeconds: config.heartbeatSeconds,
        log,
      });
      record(outcome);
      if (outcome === "requeued") {
        transientFailures++;
        await sleep(backoffMs(transientFailures, config.pollIntervalMs));
      } else {
        transientFailures = 0;
        if (outcome === "idle") await sleep(config.pollIntervalMs);
      }
    } catch (e) {
      log({ event: "loop_error", errorName: e instanceof Error ? e.name : "unknown" });
      transientFailures++;
      await sleep(backoffMs(transientFailures, config.pollIntervalMs));
    }
  }
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log({ event: "worker_stopping", reason: signal });
  wake?.();
  // 진행 중인 작업은 끝까지 기다리되 유예 시간이 지나면 종료한다(미완료 작업은 임대 만료 후 다른 Worker가 회수)
  setTimeout(() => process.exit(0), config.shutdownGraceMs).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await loop();
clearInterval(metrics);
await pool.end();
log({ event: "worker_stopped", workerId: config.workerId });