import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";
import { assertSafeToReset } from "./safe-reset";

describe("테스트 DB 초기화 안전성", () => {
  it("외부 DB URL을 거부한다", () => {
    expect(() => assertSafeToReset("postgres://test:test@db.example.test/knowflow", "1")).toThrow(
      /loopback/,
    );
  });

  it("로컬 DB도 명시적 초기화 동의 없이는 거부한다", () => {
    expect(() => assertSafeToReset("postgres://test:test@127.0.0.1/knowflow", undefined)).toThrow(
      /DB_TESTS_ALLOW_RESET=1/,
    );
  });

  it("명시적으로 허용한 loopback DB만 초기화 대상으로 받는다", () => {
    expect(() => assertSafeToReset("postgres://test:test@localhost/knowflow", "1")).not.toThrow();
  });
});

describe("RLS와 권한 경계", () => {
  it("타 사용자 행을 숨기고 부모 프로젝트의 소프트 삭제가 자료에도 전파된다", async () => {
    const ownerId = await createUser();
    const otherId = await createUser();
    const projectId = await createProject(ownerId);
    const source = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, original_url)
       values ($1, $2, 'url', '자료', 'https://example.test/source') returning id`,
      [projectId, ownerId],
    );
    const sourceId = source.rows[0]!.id;

    const ownerProjects = await as({ role: "authenticated", sub: ownerId }, (client) =>
      client.query("select id from public.projects where id = $1", [projectId]),
    );
    const otherProjects = await as({ role: "authenticated", sub: otherId }, (client) =>
      client.query("select id from public.projects where id = $1", [projectId]),
    );
    const otherSources = await as({ role: "authenticated", sub: otherId }, (client) =>
      client.query("select id from public.sources where id = $1", [sourceId]),
    );

    expect(ownerProjects.rowCount).toBe(1);
    expect(otherProjects.rowCount).toBe(0);
    expect(otherSources.rowCount).toBe(0);

    await admin("update public.projects set deleted_at = now() where id = $1", [projectId]);
    const deletedProject = await as({ role: "authenticated", sub: ownerId }, (client) =>
      client.query("select id from public.projects where id = $1", [projectId]),
    );
    const deletedSource = await as({ role: "authenticated", sub: ownerId }, (client) =>
      client.query("select id from public.sources where id = $1", [sourceId]),
    );

    expect(deletedProject.rowCount).toBe(0);
    expect(deletedSource.rowCount).toBe(0);
  });

  it("anon은 public 테이블에 직접 INSERT할 수 없다", async () => {
    const userId = await createUser();
    const denied = await failure(
      { role: "anon" },
      "insert into public.projects (user_id, name) values ($1, '직접 쓰기')",
      [userId],
    );

    expect(denied?.code).toBe("42501");
  });

  it("authenticated는 내부 쓰기 RPC와 내부 자료 테이블을 직접 호출할 수 없다", async () => {
    const userId = await createUser();
    const projectId = await createProject(userId);
    const calls = [
      { sql: "select public.consume_quota('questions', 1)", params: [] },
      { sql: "select public.refund_quota($1, 'questions', 1)", params: [userId] },
      {
        sql: "select public.enqueue_job($1, 'url', '자료', 'https://example.test/source', null, null, $2, $3)",
        params: [projectId, randomUUID(), "a".repeat(64)],
      },
      { sql: "select * from public.source_chunks limit 1", params: [] },
      { sql: "select * from public.idempotency_keys limit 1", params: [] },
    ];
    const denied = await Promise.all(
      calls.map(({ sql, params }) => failure({ role: "authenticated", sub: userId }, sql, params)),
    );

    expect(denied.map((result) => result?.code)).toEqual(calls.map(() => "42501"));
  });

  it("Storage는 비공개이며 사용자 폴더 밖의 객체를 읽거나 쓸 수 없다", async () => {
    const ownerId = await createUser();
    const otherId = await createUser();
    const bucket = await admin<{ public: boolean; file_size_limit: string }>(
      "select public, file_size_limit::text from storage.buckets where id = 'sources'",
    );
    expect(bucket.rows[0]).toEqual({ public: false, file_size_limit: "52428800" });

    await as(
      { role: "authenticated", sub: ownerId },
      (client) =>
        client.query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [
          `${ownerId}/source.pdf`,
        ]),
      { commit: true },
    );
    const foreignInsert = await failure(
      { role: "authenticated", sub: ownerId },
      "insert into storage.objects (bucket_id, name) values ('sources', $1)",
      [`${otherId}/source.pdf`],
    );
    const ownerRead = await as({ role: "authenticated", sub: ownerId }, (client) =>
      client.query("select name from storage.objects where bucket_id = 'sources'"),
    );
    const otherRead = await as({ role: "authenticated", sub: otherId }, (client) =>
      client.query("select name from storage.objects where bucket_id = 'sources'"),
    );

    expect(foreignInsert?.code).toBe("42501");
    expect(ownerRead.rows.map((row) => row.name)).toEqual([`${ownerId}/source.pdf`]);
    expect(otherRead.rowCount).toBe(0);
  });
});

describe("쿼터·멱등성·가입 트리거", () => {
  it("가입 시 프로필과 beta 쿼터가 Asia/Seoul 월 경계로 생성된다", async () => {
    const userId = await createUser("테스트 사용자");
    const created = await admin<{ display_name: string; plan_code: string; period_start: string }>(
      `select p.display_name, q.plan_code, q.period_start::text
         from public.profiles p join public.user_quotas q on q.user_id = p.id
        where p.id = $1`,
      [userId],
    );
    const period = await admin<{ period_start: string }>(
      "select public.current_period_start()::text as period_start",
    );

    expect(created.rows[0]).toEqual({
      display_name: "테스트 사용자",
      plan_code: "beta",
      period_start: period.rows[0]!.period_start,
    });
  });

  it("동시 consume_quota 요청은 플랜 한도를 넘지 않는다", async () => {
    const planCode = `p${randomUUID().replaceAll("-", "").slice(0, 31)}`;
    await admin(
      `insert into public.plans
         (code, max_projects, max_sources_per_project, monthly_questions, monthly_reports, monthly_source_jobs)
       values ($1, 20, 50, 5, 5, 5)`,
      [planCode],
    );
    const userId = await createUser();
    await admin("update public.user_quotas set plan_code = $1 where user_id = $2", [planCode, userId]);

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        as(
          { sub: userId },
          (client) => client.query("select public.consume_quota('source_jobs', 1)"),
          { commit: true },
        )
          .then(() => "ok")
          .catch((error: unknown) =>
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unexpected_error",
          ),
      ),
    );
    const used = await admin<{ used_source_jobs: number }>(
      "select used_source_jobs from public.user_quotas where user_id = $1",
      [userId],
    );

    expect(results.filter((result) => result === "ok")).toHaveLength(5);
    expect(results.filter((result) => result === "KF429")).toHaveLength(7);
    expect(used.rows[0]!.used_source_jobs).toBe(5);
  });

  it("refund_quota는 service_role만 호출하고 유효하지 않은 차감은 거부한다", async () => {
    const userId = await createUser();
    await admin("update public.user_quotas set used_source_jobs = 2 where user_id = $1", [userId]);

    const authenticatedCall = await failure(
      { role: "authenticated", sub: userId },
      "select public.refund_quota($1, 'source_jobs', 1)",
      [userId],
    );
    const invalidAmounts = await Promise.all(
      [0, -1].map((amount) =>
        failure(
          { role: "service_role" },
          "select public.refund_quota($1, 'source_jobs', $2)",
          [userId, amount],
        ),
      ),
    );
    const refunded = await as(
      { role: "service_role" },
      (client) =>
        client.query<{ used: number }>(
          "select public.refund_quota($1, 'source_jobs', 1) as used",
          [userId],
        ),
      { commit: true },
    );

    expect(authenticatedCall?.code).toBe("42501");
    expect(invalidAmounts.map((result) => result?.code)).toEqual(["22023", "22023"]);
    expect(refunded.rows[0]!.used).toBe(1);
  });

  it("update_profile은 인증 사용자 자신의 프로필만 갱신한다", async () => {
    const userId = await createUser("기존 이름");
    const updated = await as(
      { role: "authenticated", sub: userId },
      (client) => client.query("select public.update_profile('새 이름')"),
      { commit: true },
    );
    const stored = await admin<{ display_name: string }>(
      "select display_name from public.profiles where id = $1",
      [userId],
    );
    const anonymousCall = await failure(
      { role: "anon" },
      "select public.update_profile('익명')",
    );

    expect(updated.rowCount).toBe(1);
    expect(stored.rows[0]!.display_name).toBe("새 이름");
    expect(anonymousCall?.code).toBe("42501");
  });

  it("동시 같은 멱등 키는 자료·작업을 하나만 만들고 다른 요청 해시는 충돌한다", async () => {
    const userId = await createUser();
    const projectId = await createProject(userId);
    const key = randomUUID();
    const requestHash = "b".repeat(64);
    const enqueue = (hash: string) =>
      as(
        { sub: userId },
        async (client) => {
          const result = await client.query<{
            result: { source_id: string; job_id: string; duplicate: boolean };
          }>(
            `select public.enqueue_job($1, 'url', '자료', 'https://example.test/source', null, null, $2, $3) as result`,
            [projectId, key, hash],
          );
          return result.rows[0]!.result;
        },
        { commit: true },
      );

    const [first, second] = await Promise.all([enqueue(requestHash), enqueue(requestHash)]);
    const conflicting = await failure(
      { sub: userId },
      "select public.enqueue_job($1, 'url', '자료', 'https://example.test/source', null, null, $2, $3)",
      [projectId, key, "c".repeat(64)],
    );
    const resourceCounts = await admin<{ sources: number; jobs: number }>(
      `select
         (select count(*)::int from public.sources where project_id = $1) as sources,
         (select count(*)::int from public.processing_jobs where source_id = $2) as jobs`,
      [projectId, first.source_id],
    );

    expect(first.source_id).toBe(second.source_id);
    expect(first.job_id).toBe(second.job_id);
    expect(new Set([first.duplicate, second.duplicate])).toEqual(new Set([false, true]));
    expect(conflicting?.code).toBe("KF409");
    expect(resourceCounts.rows[0]).toEqual({ sources: 1, jobs: 1 });
  });
});
