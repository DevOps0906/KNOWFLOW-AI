-- KNOWFLOW nomad DB 전환 3단계 준비: 옛 버킷 sources → 새 버킷 knowflow-sources 객체 복사 목록(02_copy apply 뒤, postgres 세션).
-- 실행: psql "<DB 주소>" -v ON_ERROR_STOP=1 -At -f supabase/nomad-cutover/03_storage_map.sql > storage-map.tsv
-- 출력: 한 줄에 "옛 경로<TAB>새 경로". 새 경로는 02_copy가 nomad_knowflow.sources.storage_path에 쓴 값(첫 폴더 = organization_id).
-- 옛 객체가 Storage에 없는 자료(이미 지워진 파일)는 목록에서 빼고 건수를 NOTICE로 알린다(03_storage_verify도 같은 기준).
\set ON_ERROR_STOP on
\set QUIET on
do $$
declare n bigint;
begin
  select count(*) into n
    from nomad_knowflow.sources ns join public.sources os on os.id = ns.id
   where os.storage_path is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'sources' and o.name = os.storage_path);
  if n > 0 then
    raise notice 'missing_legacy_objects: 옛 버킷에 객체가 없는 자료 %건(목록 제외)', n;
  end if;
end $$;
select os.storage_path || E'\t' || ns.storage_path
  from nomad_knowflow.sources ns join public.sources os on os.id = ns.id
 where os.storage_path is not null
   and exists (select 1 from storage.objects o where o.bucket_id = 'sources' and o.name = os.storage_path)
 order by ns.created_at, ns.id;
