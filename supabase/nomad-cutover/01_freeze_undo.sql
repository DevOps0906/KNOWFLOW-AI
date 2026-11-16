-- KNOWFLOW nomad DB 전환 1단계 되돌리기: 01_freeze.sql이 회수한 권한·함수를 기록대로 정확히 되돌린다(postgres 세션).
-- 실행: psql "<DB 주소>" -v ON_ERROR_STOP=1 -f supabase/nomad-cutover/01_freeze_undo.sql
-- 쓰기 재개(새 앱이 쓰기 시작) 뒤에는 실행하지 않는다 — 옛 앱으로 돌아가면 그 사이 새 표에 쓴 데이터가 옛 표에 없다.
-- 02_copy.sql을 apply한 뒤 되돌리는 경우 새 nomad_knowflow 표의 복사본은 낡은 사본이 되므로, 다시 이관할 때는 비우고 시작한다(NOMAD_DB_CUTOVER.md).
begin;

do $$
begin
  if to_regclass('nomad_cutover.frozen_privileges') is null then
    raise exception 'not_frozen: nomad_cutover 기록이 없다(01_freeze를 실행하지 않았거나 이미 되돌림)' using errcode = '55000';
  end if;
end $$;

-- 권한 복구
do $$
declare r record;
begin
  for r in select * from nomad_cutover.frozen_privileges loop
    execute format('grant %s on %s %s to %s%s',
      r.privilege, r.object_kind, r.object_name,
      case when r.grantee = 'PUBLIC' then 'public' else quote_ident(r.grantee) end,
      case when r.grantable then ' with grant option' else '' end);
  end loop;
end $$;

-- 옛 가입 트리거 함수 원본 복구
do $$
declare r record;
begin
  for r in select * from nomad_cutover.frozen_functions loop
    execute r.definition;
    if (select md5(p.prosrc) from pg_proc p where p.oid = r.function_name::regprocedure) <> r.prosrc_md5 then
      raise exception 'restore_mismatch: % 본문이 원본과 다르다', r.function_name;
    end if;
  end loop;
end $$;

do $$
begin
  raise notice 'unfrozen: 권한 %건 복구, 함수 %개 복구',
    (select count(*) from nomad_cutover.frozen_privileges), (select count(*) from nomad_cutover.frozen_functions);
end $$;

drop schema nomad_cutover cascade;

commit;
