import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

export type DbRole = "anon" | "authenticated" | "service_role";

export function dbUrl(): string {
  return inject("dbUrl");
}

/** 새 연결. 호출자가 end() 한다. */
export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  return client;
}

/** 일회성 쿼리(superuser = 테스트 준비·검증용). */
export async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = await connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    await client.end();
  }
}

export interface Actor {
  /** SET LOCAL ROLE 대상. 생략하면 superuser 그대로(= 기능 RPC가 DEFINER 안에서 부르는 상황 흉내) */
  role?: DbRole;
  /** JWT sub 클레임. 생략하면 클레임 없음 */
  sub?: string;
}

/** 트랜잭션 안에서 역할·JWT 클레임을 설정하고 콜백을 실행한다. 항상 롤백한다(commit: true면 커밋). */
export async function as<T>(
  actor: Actor,
  fn: (c: pg.Client) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const client = await connect();
  try {
    await client.query("begin");
    await setActor(client, actor);
    const result = await fn(client);
    await client.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

export async function setActor(client: pg.Client, actor: Actor) {
  if (actor.sub) {
    const claims = JSON.stringify({ sub: actor.sub, role: actor.role ?? "authenticated" });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  }
  if (actor.role) await client.query(`set local role ${actor.role}`);
}

/** 실패를 기다려 SQLSTATE와 메시지를 돌려준다. 성공하면 null. */
export async function failure(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string | undefined; message: string } | null> {
  try {
    await as(actor, (c) => c.query(sql, params));
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code, message: err.message };
  }
}

/** supabase_auth_admin으로 auth.users에 INSERT(가입 흉내). profiles·user_quotas는 트리거가 만든다. */
export async function createUser(displayName?: string): Promise<string> {
  const id = randomUUID();
  const meta = displayName ? { display_name: displayName } : {};
  await as({}, async (c) => {
    await c.query("set local role supabase_auth_admin");
    await c.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id,
      `${id}@example.test`,
      JSON.stringify(meta),
    ]);
  }, { commit: true });
  return id;
}

export async function createProject(userId: string, name = "프로젝트"): Promise<string> {
  const r = await admin<{ id: string }>(
    "insert into public.projects (user_id, name) values ($1, $2) returning id",
    [userId, name],
  );
  return r.rows[0]!.id;
}

export function sha256Hex(n: number): string {
  return n.toString(16).padStart(64, "0");
}
