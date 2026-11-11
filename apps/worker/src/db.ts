import pg from "pg";
import type { WorkerConfig } from "./config.js";

/** 시작 시 DB 신원 검사가 거부한 이유. 메시지는 고정 코드라 로그에 남겨도 된다. */
export class DbIdentityError extends Error {
  constructor(readonly code: "db_superuser_refused" | "db_role_not_set") {
    super(code);
    this.name = "DbIdentityError";
  }
}

/**
 * 접속마다 지정한 역할로 전환한다(큐 함수는 service_role만 실행할 수 있다).
 * 전환에 실패하면 삼키지 않고 onRoleError로 알린다. 호출자는 로그를 남기고 프로세스를 끝낸다.
 */
export function createPool(
  config: Pick<WorkerConfig, "databaseUrl" | "dbRole">,
  onRoleError: (error: unknown) => void,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 4,
    idleTimeoutMillis: 30_000,
    // DB가 응답하지 않을 때 폴링 루프가 멈춰 있지 않게 한다
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    keepAlive: true,
  });
  pool.on("connect", (client) => {
    // 역할 이름은 config에서 형식을 검증했다
    client.query(`set role ${config.dbRole}`).catch(onRoleError);
  });
  pool.on("error", () => {
    // 유휴 연결 오류는 다음 사용 때 새 연결로 복구된다
  });
  return pool;
}

type Queryable = Pick<pg.Pool, "query">;

/** 슈퍼유저 접속이면 기동을 거부하고, SET ROLE이 실제로 적용됐는지 확인한다. */
export async function verifyDbIdentity(db: Queryable, dbRole: string): Promise<void> {
  const r = await db.query<{ current_role: string; session_super: boolean; current_super: boolean }>(
    `select current_user as current_role,
            (select rolsuper from pg_catalog.pg_roles where rolname = session_user) as session_super,
            (select rolsuper from pg_catalog.pg_roles where rolname = current_user) as current_super`,
  );
  const row = r.rows[0];
  if (!row || row.session_super !== false || row.current_super !== false) throw new DbIdentityError("db_superuser_refused");
  if (row.current_role !== dbRole) throw new DbIdentityError("db_role_not_set");
}
