import pg from "pg";
import type { WorkerConfig } from "./config.js";

/** 접속마다 지정한 역할로 전환한다(큐 함수는 service_role만 실행할 수 있다). */
export function createPool(config: Pick<WorkerConfig, "databaseUrl" | "dbRole">): pg.Pool {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4, idleTimeoutMillis: 30_000 });
  pool.on("connect", (client) => {
    // 역할 이름은 config에서 형식을 검증했다
    client.query(`set role ${config.dbRole}`).catch(() => client.end());
  });
  pool.on("error", () => {
    // 유휴 연결 오류는 다음 사용 때 새 연결로 복구된다
  });
  return pool;
}