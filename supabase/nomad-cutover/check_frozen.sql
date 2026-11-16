-- check.sh 전용: 01_freeze 뒤 옛 쓰기가 실제로 막혔는지(트랜잭션 안에서 확인하고 rollback).
\set ON_ERROR_STOP on
begin;
do $$
declare n bigint;
begin
  -- 남은 쓰기 권한 0
  select count(*) into n from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));
  if n <> 0 then raise exception 'FAIL frozen: 표 쓰기 권한 %건 남음', n; end if;
  select count(*) into n from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace and p.provolatile = 'v' and p.proname not like 'nomad\_%'
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));
  if n <> 0 then raise exception 'FAIL frozen: 쓰기 함수 EXECUTE %건 남음', n; end if;
  if not has_function_privilege('authenticated', 'public.get_source_chunks(uuid,integer,integer,uuid)', 'execute') then
    raise exception 'FAIL frozen: 읽기 함수까지 막혔다';
  end if;

  -- 실제 시도: service_role 직접 insert 거부
  begin
    perform set_config('role', 'service_role', true);
    insert into public.projects (user_id, name) values ('a0000000-0000-4000-8000-00000000000a', 'x');
    raise exception 'FAIL frozen: service_role insert가 통과했다';
  exception when insufficient_privilege then null;
  end;
  -- 실제 시도: authenticated RPC 거부
  begin
    perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);
    perform public.create_project('x', null);
    raise exception 'FAIL frozen: create_project가 통과했다';
  exception when insufficient_privilege then null;
  end;

  -- 옛 가입 트리거 무력화
  insert into auth.users (instance_id, id, aud, role, email, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'c@example.test', false);
  if exists (select 1 from public.profiles where id = 'c0000000-0000-4000-8000-00000000000c') then
    raise exception 'FAIL frozen: 옛 가입 트리거가 profiles를 만들었다';
  end if;
end $$;
rollback;
\echo 'ok: freeze 쓰기 차단·읽기 유지·옛 가입 트리거 무력화'
