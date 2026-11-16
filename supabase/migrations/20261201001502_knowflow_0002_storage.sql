-- KNOWFLOW AI · org안 Storage: 비공개 버킷 knowflow-sources(PDF 50MB). 경로 첫 폴더 = organization_id.
-- 읽기 = 조직 멤버, 업로드 = owner·admin·editor. UPDATE·DELETE 정책 없음(삭제는 서버가 service_role로).
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowflow-sources', 'knowflow-sources', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- 첫 폴더가 uuid가 아니면 거부(캐스트 오류 대신 case로 먼저 거른다)
create policy knowflow_sources_objects_select_org on storage.objects for select to authenticated
  using (bucket_id = 'knowflow-sources' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    then nomad_core.organization_role(((storage.foldername(name))[1])::uuid) is not null else false end);
create policy knowflow_sources_objects_insert_org on storage.objects for insert to authenticated
  with check (bucket_id = 'knowflow-sources' and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    then nomad_core.organization_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'editor') else false end);

commit;
