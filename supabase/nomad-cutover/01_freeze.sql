-- KNOWFLOW nomad DB 전환 1단계: 옛 public 쓰기 동결(1회 실행, postgres 세션). 되돌리기: 01_freeze_undo.sql
-- 실행: psql "<DB 주소>" -v ON_ERROR_STOP=1 -f supabase/nomad-cutover/01_freeze.sql
-- 하는 일(표·함수·데이터는 지우지 않는다):
--  1) 옛 public 표의 INSERT·UPDATE·DELETE·TRUNCATE 권한을 anon·authenticated·service_role·PUBLIC에서 회수
--  2) 옛 public의 쓰기 가능(volatile) 함수 EXECUTE를 같은 역할에서 회수 — 쓰기 RPC는 security definer라 표 권한만으로는 막히지 않는다.
--     stable 읽기 함수(get_source_chunks·list_project_jobs)는 그대로 둔다. 로그인 한도(consume_auth_rate_limit)도 막히므로 동결 중 로그인 불가.
--     core가 public에 만든 nomad_* 래퍼와 확장 소속 함수는 대상이 아니다.
--  3) 옛 가입 트리거 함수 public.handle_new_user 본문을 아무것도 하지 않게 바꾼다(원본 정의 보관).
--     auth.users 소유자가 아니면 트리거 disable을 못 하므로 함수 본문을 바꾼다(소유자 postgres).
--  4) 옛 pg_cron 작업: KNOWFLOW 옛 마이그레이션에는 없다. public.* 를 부르는 작업이 있으면 중단(수동 확인).
-- 회수한 권한·원본 함수 정의는 nomad_cutover 스키마에 기록한다(노출 안 함, RLS, 권한 없음). 02_copy.sql은 이 기록이 있어야 실행된다.
begin;

do $$
begin
  if to_regclass('nomad_cutover.frozen_privileges') is not null then
    raise exception 'already_frozen: nomad_cutover 기록이 이미 있다(01_freeze 재실행 금지)' using errcode = '55000';
  end if;
  if to_regprocedure('public.handle_new_user()') is null or to_regclass('public.projects') is null then
    raise exception 'legacy_schema_missing: 옛 KNOWFLOW public 스키마가 아니다' using errcode = '55000';
  end if;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where command ~* 'public\.') then
      raise exception 'legacy_cron_jobs: public.* 를 부르는 pg_cron 작업이 있다 — 수동 확인 후 unschedule'
        using errcode = '55000',
              detail = (select string_agg(jobname || ': ' || command, '; ') from cron.job where command ~* 'public\.');
    end if;
  end if;
end $$;

create schema nomad_cutover;
revoke all on schema nomad_cutover from public, anon, authenticated, service_role;

create table nomad_cutover.frozen_privileges (
  object_kind text not null check (object_kind in ('table', 'function')),
  object_name text not null,           -- regclass / regprocedure 텍스트
  grantee text not null,               -- 역할 이름 또는 PUBLIC
  privilege text not null,
  grantable boolean not null,
  primary key (object_kind, object_name, grantee, privilege)
);
create table nomad_cutover.frozen_functions (
  function_name text primary key,      -- regprocedure 텍스트
  definition text not null,            -- pg_get_functiondef 원본
  prosrc_md5 text not null
);
create table nomad_cutover.freeze_log (
  frozen_at timestamptz not null default now(),
  frozen_by text not null default current_user
);
alter table nomad_cutover.frozen_privileges enable row level security;
alter table nomad_cutover.frozen_functions enable row level security;
alter table nomad_cutover.freeze_log enable row level security;
revoke all on all tables in schema nomad_cutover from public, anon, authenticated, service_role;

-- 1) 표 쓰기 권한 기록
insert into nomad_cutover.frozen_privileges
select 'table', c.oid::regclass::text,
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
       a.privilege_type, a.is_grantable
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
   and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
   and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));

-- 2) 쓰기 함수 EXECUTE 기록(proacl null = 기본값 PUBLIC 실행)
insert into nomad_cutover.frozen_privileges
select 'function', p.oid::regprocedure::text,
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
       a.privilege_type, a.is_grantable
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where p.pronamespace = 'public'::regnamespace
   and p.prokind = 'f'
   and p.provolatile = 'v'
   and p.proname not like 'nomad\_%'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));

-- 회수
do $$
declare r record;
begin
  for r in select * from nomad_cutover.frozen_privileges loop
    execute format('revoke %s on %s %s from %s',
      r.privilege, r.object_kind, r.object_name,
      case when r.grantee = 'PUBLIC' then 'public' else quote_ident(r.grantee) end);
  end loop;
end $$;

-- 3) 옛 가입 트리거 함수 무력화(원본 보관)
insert into nomad_cutover.frozen_functions
select p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(p.prosrc)
  from pg_proc p where p.oid = 'public.handle_new_user()'::regprocedure;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- nomad 전환 동결 중(01_freeze.sql): 옛 profiles·user_quotas를 만들지 않는다. 가입 처리는 nomad_core.handle_new_user
  return new;
end;
$$;

insert into nomad_cutover.freeze_log default values;

do $$
begin
  raise notice 'frozen: 표 권한 %건, 함수 EXECUTE %건 회수, handle_new_user 무력화',
    (select count(*) from nomad_cutover.frozen_privileges where object_kind = 'table'),
    (select count(*) from nomad_cutover.frozen_privileges where object_kind = 'function');
end $$;

commit;
