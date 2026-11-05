// 환경 변수 → 설정. DATABASE_URL 등 비밀 값은 로그에 남기지 않는다(log.ts는 허용 필드만 출력).
export interface WorkerConfig {
  databaseUrl: string;
  /** 접속 직후 SET ROLE 할 역할. Supabase의 service_role 권한으로 큐 함수를 호출한다. */
  dbRole: string;
  workerId: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  shutdownGraceMs: number;
  metricsIntervalMs: number;
  dummyHandlers: boolean;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 값이 범위(${min}~${max})를 벗어났습니다`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다");
  const dbRole = env.WORKER_DB_ROLE ?? "service_role";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbRole)) throw new Error("WORKER_DB_ROLE 형식이 올바르지 않습니다");
  const leaseSeconds = int(env, "WORKER_LEASE_SECONDS", 120, 10, 3600);
  const heartbeatSeconds = int(env, "WORKER_HEARTBEAT_SECONDS", 30, 1, 1800);
  if (heartbeatSeconds * 2 > leaseSeconds) throw new Error("heartbeat 주기는 임대 시간의 절반 이하여야 합니다");
  return {
    databaseUrl,
    dbRole,
    workerId: env.WORKER_ID || `worker-${process.pid}`,
    pollIntervalMs: int(env, "WORKER_POLL_INTERVAL_MS", 1000, 50, 60_000),
    leaseSeconds,
    heartbeatSeconds,
    shutdownGraceMs: int(env, "WORKER_SHUTDOWN_GRACE_MS", 25_000, 0, 600_000),
    metricsIntervalMs: int(env, "WORKER_METRICS_INTERVAL_MS", 30_000, 1000, 3_600_000),
    dummyHandlers: env.WORKER_DUMMY_HANDLERS === "1",
  };
}