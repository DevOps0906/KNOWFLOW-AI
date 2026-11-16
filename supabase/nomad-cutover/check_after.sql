-- check.sh 전용: 02_copy apply 뒤 값 대조·개인 조직 소유·구독·경로·RLS 격리(트랜잭션 안에서 확인하고 rollback).
\set ON_ERROR_STOP on
begin;
create temp table t_org on commit drop as
select m.user_id, o.id as org_id from nomad_core.organizations o
  join nomad_core.memberships m on m.organization_id = o.id and m.role = 'owner' and o.kind = 'personal';

do $$
declare a uuid := 'a0000000-0000-4000-8000-00000000000a'; b uuid := 'b0000000-0000-4000-8000-00000000000b';
        oa uuid; ob uuid; n bigint;
begin
  select org_id into oa from t_org where user_id = a;
  select org_id into ob from t_org where user_id = b;
  if oa is null or ob is null or oa = ob then raise exception 'FAIL after: 개인 조직 없음'; end if;

  -- 소유 이전
  if (select count(*) from nomad_knowflow.projects where organization_id = oa) <> 2
     or (select count(*) from nomad_knowflow.projects where organization_id = ob) <> 1 then
    raise exception 'FAIL after: 프로젝트 소유 이전';
  end if;
  -- set local replica가 먹었다: updated_at·deleted_at 원본 유지
  if (select updated_at from nomad_knowflow.projects where id = 'a1000000-0000-4000-8000-000000000001') <> '2026-10-06 10:00+09'
     or (select deleted_at from nomad_knowflow.projects where id = 'a1000000-0000-4000-8000-000000000002') <> '2026-10-20 10:00+09'
     or (select updated_at from nomad_knowflow.conversations where id = 'a5000000-0000-4000-8000-000000000001') <> '2026-10-06 09:05+09' then
    raise exception 'FAIL after: 원본 시각이 바뀌었다(replica 미적용)';
  end if;
  if current_setting('session_replication_role') <> 'origin' then raise exception 'FAIL after: 세션에 replica가 남았다'; end if;
  -- 경로: 첫 폴더 user_id → organization_id
  if (select storage_path from nomad_knowflow.sources where id = 'a2000000-0000-4000-8000-000000000001')
     <> oa::text || '/a1000000-0000-4000-8000-000000000001/f1.pdf' then
    raise exception 'FAIL after: PDF 경로';
  end if;
  -- 구독: beta→B, pro→A (check.sh plan_map)
  if (select plan_code from nomad_core.subscriptions where organization_id = oa and product_code = 'knowflow') <> 'B'
     or (select plan_code from nomad_core.subscriptions where organization_id = ob and product_code = 'knowflow') <> 'A' then
    raise exception 'FAIL after: 구독 플랜 대응';
  end if;
  -- 프로필: 원본 이름·생성 시각으로 덮고, 원본 null이면 백필 값 유지
  if (select display_name from nomad_core.profiles where user_id = a) <> 'Alice'
     or (select created_at from nomad_core.profiles where user_id = a) <> '2026-10-01 09:00+09'
     or (select display_name from nomad_core.profiles where user_id = b) is null then
    raise exception 'FAIL after: profiles upsert';
  end if;
  -- 사용량·멱등 키·사용자 없는 사용량
  if (select used_questions from nomad_knowflow.org_quotas where organization_id = oa) <> 7
     or not exists (select 1 from nomad_knowflow_private.idempotency_keys where organization_id = ob and key = 'create-b1')
     or not exists (select 1 from nomad_knowflow.usage_events where id = 'aa000000-0000-4000-8000-000000000002' and organization_id is null) then
    raise exception 'FAIL after: 사용량·멱등 키';
  end if;

  -- RLS 격리: A는 자기 것만(소프트 삭제 프로젝트 숨김), B 것은 못 본다
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select count(*) from nomad_knowflow.projects) <> 1
     or exists (select 1 from nomad_knowflow.projects where organization_id = ob)
     or exists (select 1 from nomad_knowflow.messages where conversation_id = 'b5000000-0000-4000-8000-000000000001')
     or exists (select 1 from nomad_knowflow.sources where organization_id = ob)
     or (select count(*) from nomad_knowflow.messages) <> 2 then
    raise exception 'FAIL after: RLS 격리(A)';
  end if;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if (select count(*) from nomad_knowflow.projects) <> 1
     or exists (select 1 from nomad_knowflow.projects where organization_id = oa)
     or exists (select 1 from nomad_knowflow.reports where organization_id = oa) then
    raise exception 'FAIL after: RLS 격리(B)';
  end if;
  perform set_config('role', 'postgres', true);
end $$;
rollback;
\echo 'ok: 값 대조·소유 이전·구독·경로·RLS 격리'
