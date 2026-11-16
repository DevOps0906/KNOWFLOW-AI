-- task-004 [6/6] Storage 버킷 sources: 비공개, 경로 첫 폴더 = user_id, 읽기는 서명 URL
-- 실제 Supabase에서만 확인할 항목은 docs/security/supabase-verify.md

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 52428800, array['application/pdf']) -- 50MB (PRD 8-1)
on conflict (id) do nothing;

-- 본인 폴더만 읽기(서명 URL 발급 포함)·업로드. UPDATE·DELETE 정책 없음(삭제는 서버가 service_role로)
create policy sources_objects_select_own on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy sources_objects_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
