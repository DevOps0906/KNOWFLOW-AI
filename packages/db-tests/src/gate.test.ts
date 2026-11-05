import { describe, expect, it } from "vitest";
import { admin } from "./db";
import { ALL_TABLES, ANON_EXECUTE, AUTHENTICATED_EXECUTE, AUTHENTICATED_SELECT, SERVICE_ROLE_EXECUTE } from "./allowlist";

// 카탈로그 기반 게이트: 앞으로 추가되는 테이블·함수에도 자동 적용된다.

async function names(sql: string): Promise<string[]> {
  const r = await admin<{ name: string }>(sql);
  return r.rows.map((x) => x.name).sort();
}

describe("카탈로그 게이트: 테이블", () => {
  it("public 테이블 목록이 기대와 같다(새 테이블은 allowlist.ts에 추가해야 통과)", async () => {
    const t = await names(
      "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')",
    );
    expect(t).toEqual([...ALL_TABLES].sort());
  });

  it("모든 public 테이블에 RLS가 켜져 있다", async () => {
    const t = await names(
      "select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity",
    );
    expect(t).toEqual([]);
  });

  it("모든 public 테이블에 정책이 하나 이상 있다", async () => {
    const t = await names(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p')
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`,
    );
    expect(t).toEqual([]);
  });

  it("무조건 true인 쓰기 정책이 없다(SELECT 정책의 true는 plans 시드뿐)", async () => {
    const t = await names(
      `select tablename || '.' || policyname as name from pg_policies
        where schemaname = 'public' and (qual = 'true' or with_check = 'true')
          and not (tablename = 'plans' and cmd = 'SELECT')`,
    );
    expect(t).toEqual([]);
  });

  it("anon에는 public 테이블 권한이 전혀 없다(컬럼 권한 포함)", async () => {
    const t = await names(
      `select c.relname || ':' || p.priv as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
        where n.nspname = 'public' and c.relkind in ('r','p')
          and (has_table_privilege('anon', c.oid, p.priv)
               or (p.priv in ('SELECT','INSERT','UPDATE') and has_any_column_privilege('anon', c.oid, p.priv)))`,
    );
    expect(t).toEqual([]);
  });

  it("authenticated는 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 권한이 0이다(컬럼 포함)", async () => {
    const t = await names(
      `select c.relname || ':' || p.priv as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
        where n.nspname = 'public' and c.relkind in ('r','p')
          and (has_table_privilege('authenticated', c.oid, p.priv)
               or (p.priv in ('INSERT','UPDATE','REFERENCES') and has_any_column_privilege('authenticated', c.oid, p.priv)))`,
    );
    expect(t).toEqual([]);
  });

  it("authenticated의 SELECT 가능 테이블 = 허용 목록(source_chunks·idempotency_keys 제외)", async () => {
    const t = await names(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege('authenticated', c.oid, 'SELECT')`,
    );
    expect(t).toEqual([...AUTHENTICATED_SELECT].sort());
  });

  it("시퀀스에 anon/authenticated 권한이 없다", async () => {
    const t = await names(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S'
          and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE')
               or has_sequence_privilege('authenticated', c.oid, 'UPDATE') or has_sequence_privilege('anon', c.oid, 'UPDATE'))`,
    );
    expect(t).toEqual([]);
  });

  it("public 스키마에 anon/authenticated CREATE 권한이 없다", async () => {
    const r = await admin<{ a: boolean; b: boolean }>(
      "select has_schema_privilege('anon','public','CREATE') a, has_schema_privilege('authenticated','public','CREATE') b",
    );
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });
});

describe("카탈로그 게이트: 함수", () => {
  it("SECURITY DEFINER 함수는 모두 search_path가 빈 값으로 고정되어 있다", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not coalesce((select bool_or(cfg = 'search_path=""' or cfg = 'search_path=') from unnest(p.proconfig) cfg), false)`,
    );
    expect(t).toEqual([]);
  });

  it("모든 public 함수가 search_path를 고정한다(INVOKER 포함)", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not coalesce((select bool_or(cfg like 'search_path=%') from unnest(p.proconfig) cfg), false)`,
    );
    expect(t).toEqual([]);
  });

  it("anon EXECUTE 목록 = 허용 목록 (PUBLIC 부여 포함)", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(t).toEqual([...ANON_EXECUTE].sort());
  });

  it("PUBLIC에 EXECUTE가 열린 public 함수가 없다", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))`,
    );
    expect(t).toEqual([]);
  });

  it("authenticated EXECUTE 목록 = 허용 목록", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    );
    expect(t).toEqual([...AUTHENTICATED_EXECUTE].sort());
  });

  it("service_role EXECUTE 목록 = 허용 목록", async () => {
    const t = await names(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE')`,
    );
    expect(t).toEqual([...SERVICE_ROLE_EXECUTE].sort());
  });
});

describe("기본 권한: 이후 객체도 안전하다", () => {
  it("새로 만든 테이블·함수는 anon/authenticated 권한을 받지 않고 PUBLIC EXECUTE도 없다", async () => {
    const r = await admin<Record<string, boolean>>(
      `do $$ begin
         create table public.zz_probe (id int);
         create function public.zz_probe_fn() returns int language sql set search_path = '' as 'select 1';
       end $$;
       select 1`,
    ).catch((e) => {
      throw e;
    });
    void r;
    const q = await admin<Record<string, boolean>>(
      `select has_table_privilege('anon','public.zz_probe','SELECT') as anon_sel,
              has_table_privilege('authenticated','public.zz_probe','SELECT') as auth_sel,
              has_table_privilege('authenticated','public.zz_probe','INSERT') as auth_ins,
              has_function_privilege('anon','public.zz_probe_fn()','EXECUTE') as anon_fn,
              has_function_privilege('authenticated','public.zz_probe_fn()','EXECUTE') as auth_fn`,
    );
    await admin("drop table public.zz_probe; drop function public.zz_probe_fn()");
    expect(q.rows[0]).toEqual({ anon_sel: false, auth_sel: false, auth_ins: false, anon_fn: false, auth_fn: false });
  });
});
