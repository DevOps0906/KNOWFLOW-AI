import { describe, expect, it } from "vitest";
import { admin, as, failure, sha256Hex } from "./db";

type Row = { allowed: boolean; retry_after: number };

async function hit(scope: string, key: string, role: "anon" | "authenticated" = "anon") {
  const r = await as(
    { role },
    (c) => c.query<Row>("select * from public.consume_auth_rate_limit($1, $2)", [scope, key]),
    { commit: true },
  );
  return r.rows[0]!;
}

describe("인증 앱 한도", () => {
  it("로그인은 같은 키로 5번까지 허용하고 6번째부터 거부하며 대기 시간을 돌려준다", async () => {
    const key = sha256Hex(101);
    for (let i = 0; i < 5; i++) expect((await hit("login_ip", key)).allowed).toBe(true);
    const sixth = await hit("login_ip", key);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retry_after).toBeGreaterThanOrEqual(1);
    expect(sixth.retry_after).toBeLessThanOrEqual(60);
  });

  it("키가 다르면 서로 영향을 주지 않는다", async () => {
    for (let i = 0; i < 6; i++) await hit("login_ip", sha256Hex(102));
    expect((await hit("login_ip", sha256Hex(103))).allowed).toBe(true);
  });

  it("재설정 메일은 계정당 시간당 3번까지다", async () => {
    const key = sha256Hex(104);
    for (let i = 0; i < 3; i++) expect((await hit("reset_email", key)).allowed).toBe(true);
    expect((await hit("reset_email", key)).allowed).toBe(false);
  });

  it("동시 요청에도 허용 횟수가 한도를 넘지 않는다", async () => {
    const key = sha256Hex(105);
    const results = await Promise.all(Array.from({ length: 12 }, () => hit("login_email", key)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("알 수 없는 범위와 형식이 틀린 키는 거부한다", async () => {
    const badScope = await failure(
      { role: "anon" },
      "select * from public.consume_auth_rate_limit('x', $1)",
      [sha256Hex(1)],
    );
    const badKey = await failure(
      { role: "anon" },
      "select * from public.consume_auth_rate_limit('login_ip', 'user@example.com')",
    );
    expect(badScope?.code).toBe("22023");
    expect(badKey?.code).toBe("22023");
  });

  it("테이블은 어떤 클라이언트 역할도 직접 읽거나 쓸 수 없다", async () => {
    await hit("login_ip", sha256Hex(106));
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      const read = await failure({ role }, "select * from public.auth_rate_limits");
      const write = await failure({ role }, "delete from public.auth_rate_limits");
      expect(read?.code).toBe("42501");
      expect(write?.code).toBe("42501");
    }
    const rows = await admin<{ n: number }>("select count(*)::int as n from public.auth_rate_limits");
    expect(rows.rows[0]!.n).toBeGreaterThan(0);
  });
});
