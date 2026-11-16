-- KNOWFLOW nomad DB 전환 3단계 대조: 복사한 객체 개수·크기 확인(03_storage_copy.mjs --apply 뒤, postgres 세션). 읽기만 한다.
-- 실행: psql "<DB 주소>" -v ON_ERROR_STOP=1 -f supabase/nomad-cutover/03_storage_verify.sql
-- 기준: 옛 객체가 있는 자료마다 새 버킷 knowflow-sources의 새 경로에 객체가 있고 metadata size가 같아야 한다. 하나라도 어긋나면 raise.
-- 이 검사가 통과해야 새 앱을 배포한다(새 앱은 새 경로로만 읽는다). 옛 버킷 sources는 지우지 않는다.
\set ON_ERROR_STOP on
do $$
declare v_total bigint; v_missing bigint; v_size bigint; v_detail text;
begin
  with pairs as (
    select ns.id, ns.storage_path as new_path,
           (select (o.metadata ->> 'size')::bigint from storage.objects o where o.bucket_id = 'sources' and o.name = os.storage_path) as old_size,
           (select (o.metadata ->> 'size')::bigint from storage.objects o where o.bucket_id = 'knowflow-sources' and o.name = ns.storage_path) as new_size,
           exists (select 1 from storage.objects o where o.bucket_id = 'knowflow-sources' and o.name = ns.storage_path) as new_exists
      from nomad_knowflow.sources ns join public.sources os on os.id = ns.id
     where os.storage_path is not null
       and exists (select 1 from storage.objects o where o.bucket_id = 'sources' and o.name = os.storage_path))
  select count(*),
         count(*) filter (where not new_exists),
         count(*) filter (where new_exists and new_size is distinct from old_size),
         string_agg(new_path, ', ') filter (where not new_exists or new_size is distinct from old_size)
    into v_total, v_missing, v_size, v_detail
    from pairs;
  if v_missing > 0 or v_size > 0 then
    raise exception 'storage_mismatch: 대상 %건 중 없음 %건, 크기 다름 %건', v_total, v_missing, v_size
      using errcode = 'P0001', detail = left(v_detail, 2000);
  end if;
  raise notice 'storage_ok: %건 개수·크기 일치', v_total;
end $$;
