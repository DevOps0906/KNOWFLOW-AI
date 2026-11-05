import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

type Project = { id: string; user_id: string; name: string; description: string | null; archived_at: string | null; deleted_at: string | null };

const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

async function create(sub: string, name: string, description?: string | null) {
  const r = await as(
    asUser(sub),
    (c) => c.query<Project>("select * from public.create_project($1, $2)", [name, description ?? null]),
    { commit: true },
  );
  return r.rows[0]!;
}

describe("create_project", () => {
  it("소유자를 호출자로 채우고 이름을 다듬는다", async () => {
    const uid = await createUser();
    const p = await create(uid, "  첫 프로젝트  ", "  설명  ");
    expect(p.user_id).toBe(uid);
    expect(p.name).toBe("첫 프로젝트");
    expect(p.description).toBe("설명");
  });

  it("user_id를 받는 인자가 없어 다른 사용자 명의로 만들 수 없다", async () => {
    const r = await admin<{ args: string }>(
      "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_project'",
    );
    expect(r.rows[0]!.args).toBe("p_name text, p_description text");
  });

  it("이름이 비었거나 100자를 넘으면 422(22023), 로그인하지 않으면 28000", async () => {
    const uid = await createUser();
    expect((await failure(asUser(uid), "select * from public.create_project('   ')"))?.code).toBe("22023");
    expect((await failure(asUser(uid), "select * from public.create_project($1)", ["가".repeat(101)]))?.code).toBe("22023");
    expect((await failure(asUser(uid), "select * from public.create_project('a', $1)", ["x".repeat(1001)]))?.code).toBe("22023");
    expect((await failure({ role: "authenticated" }, "select * from public.create_project('a')"))?.code).toBe("28000");
    expect((await failure({ role: "anon" }, "select * from public.create_project('a')"))?.code).toBe("42501");
  });

  it("21번째 프로젝트는 한도 초과(KF429), 삭제한 프로젝트는 세지 않는다", async () => {
    const uid = await createUser();
    for (let i = 0; i < 20; i++) await create(uid, `p${i}`);
    expect((await failure(asUser(uid), "select * from public.create_project('21번째')"))?.code).toBe("KF429");
    const first = await admin<{ id: string }>("select id from public.projects where user_id = $1 limit 1", [uid]);
    await as(asUser(uid), (c) => c.query("select public.delete_project($1)", [first.rows[0]!.id]), { commit: true });
    await expect(create(uid, "다시 가능")).resolves.toMatchObject({ name: "다시 가능" });
  });

  it("동시 생성도 한도를 넘지 않는다", async () => {
    const uid = await createUser();
    for (let i = 0; i < 18; i++) await create(uid, `p${i}`);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(uid, `race${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const n = await admin<{ n: number }>("select count(*)::int as n from public.projects where user_id = $1", [uid]);
    expect(n.rows[0]!.n).toBe(20);
  });
});

describe("update_project", () => {
  it("이름·설명·보관 상태를 바꾼다", async () => {
    const uid = await createUser();
    const p = await create(uid, "원래");
    const r = await as(asUser(uid), (c) =>
      c.query<Project>("select * from public.update_project($1, $2::jsonb)", [
        p.id,
        JSON.stringify({ name: " 새 이름 ", description: null, archived: true }),
      ]),
    );
    expect(r.rows[0]!.name).toBe("새 이름");
    expect(r.rows[0]!.archived_at).not.toBeNull();
  });

  it("사용자 A가 사용자 B의 프로젝트를 수정하면 대상 없음(P0002)이고 값은 그대로다", async () => {
    const a = await createUser();
    const b = await createUser();
    const p = await create(b, "B의 프로젝트");
    const denied = await failure(asUser(a), "select * from public.update_project($1, $2::jsonb)", [
      p.id,
      JSON.stringify({ name: "탈취" }),
    ]);
    expect(denied?.code).toBe("P0002");
    const row = await admin<{ name: string }>("select name from public.projects where id = $1", [p.id]);
    expect(row.rows[0]!.name).toBe("B의 프로젝트");
  });

  it("모르는 키(user_id 포함)·빈 패치·잘못된 형식은 거부한다", async () => {
    const uid = await createUser();
    const other = await createUser();
    const p = await create(uid, "프로젝트");
    for (const patch of [{ user_id: other }, {}, { name: 5 }, { archived: "yes" }, { name: "" }]) {
      const e = await failure(asUser(uid), "select * from public.update_project($1, $2::jsonb)", [p.id, JSON.stringify(patch)]);
      expect(e?.code).toBe("22023");
    }
    const row = await admin<{ user_id: string }>("select user_id from public.projects where id = $1", [p.id]);
    expect(row.rows[0]!.user_id).toBe(uid);
  });

  it("삭제된 프로젝트는 수정할 수 없다", async () => {
    const uid = await createUser();
    const p = await create(uid, "곧 삭제");
    await admin("update public.projects set deleted_at = now() where id = $1", [p.id]);
    const e = await failure(asUser(uid), "select * from public.update_project($1, $2::jsonb)", [p.id, JSON.stringify({ name: "x" })]);
    expect(e?.code).toBe("P0002");
  });
});

describe("delete_project", () => {
  it("본인 프로젝트를 소프트 삭제하고 목록에서 사라진다", async () => {
    const uid = await createUser();
    const p = await create(uid, "삭제 대상");
    await as(asUser(uid), (c) => c.query("select public.delete_project($1)", [p.id]), { commit: true });
    const row = await admin<{ deleted_at: string | null }>("select deleted_at from public.projects where id = $1", [p.id]);
    expect(row.rows[0]!.deleted_at).not.toBeNull();
    const visible = await as(asUser(uid), (c) => c.query("select id from public.projects where id = $1", [p.id]));
    expect(visible.rowCount).toBe(0);
  });

  it("사용자 A가 사용자 B의 프로젝트를 삭제하면 P0002이고 삭제되지 않는다", async () => {
    const a = await createUser();
    const b = await createUser();
    const p = await create(b, "B의 프로젝트");
    expect((await failure(asUser(a), "select public.delete_project($1)", [p.id]))?.code).toBe("P0002");
    const row = await admin<{ deleted_at: string | null }>("select deleted_at from public.projects where id = $1", [p.id]);
    expect(row.rows[0]!.deleted_at).toBeNull();
  });

  it("처리 중 작업이 있으면 KF409, 끝나면 삭제된다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const source = await admin<{ id: string }>(
      "insert into public.sources (project_id, user_id, source_type, title, original_url) values ($1, $2, 'url', '자료', 'https://example.test/a') returning id",
      [projectId, uid],
    );
    const job = await admin<{ id: string }>(
      "insert into public.processing_jobs (user_id, source_id, job_type, status) values ($1, $2, 'source_ingest', 'running') returning id",
      [uid, source.rows[0]!.id],
    );
    expect((await failure(asUser(uid), "select public.delete_project($1)", [projectId]))?.code).toBe("KF409");
    await admin("update public.processing_jobs set status = 'succeeded', progress = 100 where id = $1", [job.rows[0]!.id]);
    expect(await failure(asUser(uid), "select public.delete_project($1)", [projectId])).toBeNull();
  });

  it("authenticated는 projects 테이블을 직접 수정·삭제할 수 없다", async () => {
    const uid = await createUser();
    const p = await create(uid, "직접 수정 금지");
    const upd = await failure(asUser(uid), "update public.projects set name = 'x' where id = $1", [p.id]);
    const del = await failure(asUser(uid), "delete from public.projects where id = $1", [p.id]);
    expect(upd?.code).toBe("42501");
    expect(del?.code).toBe("42501");
  });
});
