import { GEMINI_SETTINGS } from "./youtube/settings.js";

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
  /** 원본 읽기 어댑터. fixture는 로컬 검증 전용(마운트한 폴더), storage는 미구현 */
  sourceReader: "fixture" | "storage";
  fixtureDir: string | null;
  /** 후행 요약 공급자. stub은 로컬 검증 전용, none이면 요약하지 않는다 */
  summaryProvider: "stub" | "none";
  /** 유튜브 처리 기능 플래그(YOUTUBE_ENABLED=1, 기본 꺼짐). 꺼지면 유튜브 처리를 등록하지 않는다 */
  youtubeEnabled: boolean;
  /** 영상 분석 공급자. stub은 로컬 검증 전용, gemini는 명시적으로 고를 때만 */
  youtubeAnalyzer: "stub" | "gemini";
  /** Worker 전용 Gemini 키. 로그에 남기지 않는다. 플래그 꺼짐·스텁이면 null */
  geminiApiKey: string | null;
  geminiModel: string;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 값이 범위(${min}~${max})를 벗어났습니다`);
  return n;
}

/** 허용 값 중 하나. 비어 있으면 첫 값(기본값) */
function oneOf<const T extends readonly string[]>(env: NodeJS.ProcessEnv, name: string, values: T): T[number] {
  const raw = env[name];
  if (raw === undefined || raw === "") return values[0] as T[number];
  if (!values.includes(raw)) throw new Error(`${name} 값은 ${values.join("·")} 중 하나여야 합니다`);
  return raw as T[number];
}

const DUMMY_DB_HOSTS = new Set(["db", "localhost", "127.0.0.1", "[::1]"]);

// 더미 핸들러·고정 파일 어댑터·스텁 요약·스텁 영상 분석기는 실제 처리가 아니므로 로컬 DB에서만 허용한다
function assertLocalDb(databaseUrl: string, what: string) {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL 형식이 올바르지 않습니다");
  }
  if (!DUMMY_DB_HOSTS.has(host)) throw new Error(`${what}는 compose db·loopback DB에서만 쓸 수 있습니다`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다");
  const dbRole = env.WORKER_DB_ROLE ?? "service_role";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbRole)) throw new Error("WORKER_DB_ROLE 형식이 올바르지 않습니다");
  const leaseSeconds = int(env, "WORKER_LEASE_SECONDS", 120, 10, 3600);
  const heartbeatSeconds = int(env, "WORKER_HEARTBEAT_SECONDS", 30, 1, 1800);
  if (heartbeatSeconds * 2 > leaseSeconds) throw new Error("heartbeat 주기는 임대 시간의 절반 이하여야 합니다");
  const dummyHandlers = env.WORKER_DUMMY_HANDLERS === "1";
  if (dummyHandlers) assertLocalDb(databaseUrl, "더미 핸들러");
  const sourceReader = oneOf(env, "WORKER_SOURCE_READER", ["storage", "fixture"] as const);
  const fixtureDir = env.WORKER_FIXTURE_DIR || null;
  if (sourceReader === "fixture") {
    assertLocalDb(databaseUrl, "고정 파일 어댑터");
    if (!fixtureDir) throw new Error("WORKER_SOURCE_READER=fixture에는 WORKER_FIXTURE_DIR이 필요합니다");
  }
  const summaryProvider = oneOf(env, "WORKER_SUMMARY_PROVIDER", ["none", "stub"] as const);
  if (summaryProvider === "stub") assertLocalDb(databaseUrl, "스텁 요약 공급자");
  const youtubeEnabled = env.YOUTUBE_ENABLED === "1";
  const youtubeAnalyzer = oneOf(env, "YOUTUBE_ANALYZER", ["stub", "gemini"] as const);
  const geminiModel = env.GEMINI_MODEL || GEMINI_SETTINGS.defaultModel;
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(geminiModel)) throw new Error("GEMINI_MODEL 형식이 올바르지 않습니다");
  let geminiApiKey: string | null = null;
  // 운영(로컬 DB가 아님)에서 플래그를 켰는데 스텁이 선택됐거나 키가 없으면 기동을 거부한다
  if (youtubeEnabled && youtubeAnalyzer === "stub") assertLocalDb(databaseUrl, "스텁 영상 분석기");
  if (youtubeEnabled && youtubeAnalyzer === "gemini") {
    geminiApiKey = env.GEMINI_API_KEY ?? "";
    // 헤더에 그대로 실리므로 출력 가능한 ASCII만 허용한다(값은 메시지에 넣지 않는다)
    if (!/^[\x21-\x7e]{1,256}$/.test(geminiApiKey)) throw new Error("YOUTUBE_ANALYZER=gemini에는 올바른 GEMINI_API_KEY가 필요합니다");
  }
  return {
    databaseUrl,
    dbRole,
    workerId: env.WORKER_ID || `worker-${process.pid}`,
    pollIntervalMs: int(env, "WORKER_POLL_INTERVAL_MS", 1000, 50, 60_000),
    leaseSeconds,
    heartbeatSeconds,
    shutdownGraceMs: int(env, "WORKER_SHUTDOWN_GRACE_MS", 25_000, 0, 600_000),
    metricsIntervalMs: int(env, "WORKER_METRICS_INTERVAL_MS", 30_000, 1000, 3_600_000),
    dummyHandlers,
    sourceReader,
    fixtureDir,
    summaryProvider,
    youtubeEnabled,
    youtubeAnalyzer,
    geminiApiKey,
    geminiModel,
  };
}