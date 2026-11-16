-- task-008: PDF 자료 등록 RPC. Storage에 올라간 객체를 DB가 다시 확인한 뒤 enqueue_job으로 sources(queued)·processing_jobs를 만든다.
-- 오류 코드(SQLSTATE): 28000 미인증, P0002 프로젝트 없음(타인 것도 동일), 22023 잘못된 입력·객체 없음,
--   KF413 객체 크기 초과, KF415 PDF가 아님(MIME), KF429 한도 초과, KF409 같은 내용 중복·멱등 키 충돌
-- 쪽수·스캔 PDF 판정과 content_hash 검증은 Worker가 한다(task-011). 여기의 content_hash는 클라이언트 값(중복 안내용).

create function public.register_pdf_source(
  p_project_id uuid,
  p_title text,
  p_storage_path text,
  p_content_hash text,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_size bigint;
  v_mime text;
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_uid::text || '/' || coalesce(p_project_id::text, '') || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'invalid_storage_path' using errcode = '22023';
  end if;

  -- 프로젝트 행을 먼저 잠가(enqueue_job도 같은 잠금) 같은 프로젝트의 동시 등록을 직렬화한다
  perform 1 from public.projects where id = p_project_id and user_id = v_uid and deleted_at is null for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  -- Storage 객체 메타데이터 재확인(본인 폴더만 보이는 RLS와 무관하게 DEFINER가 직접 조회)
  select metadata into v_meta from storage.objects where bucket_id = 'sources' and name = p_storage_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = '22023';
  end if;
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  if v_size is null or v_size < 1 then
    raise exception 'storage_object_empty' using errcode = '22023';
  end if;
  if v_size > 52428800 then
    raise exception 'file_too_large' using errcode = 'KF413';
  end if;
  if v_mime <> 'application/pdf' then
    raise exception 'unsupported_media_type' using errcode = 'KF415';
  end if;

  -- 같은 프로젝트에 같은 내용(content_hash)이 이미 있으면 409. 같은 멱등 키의 재요청은 enqueue_job이 기존 결과를 돌려주므로 통과시킨다.
  if p_content_hash is not null
     and not exists (select 1 from public.idempotency_keys where user_id = v_uid and key = p_idempotency_key)
     and exists (
       select 1 from public.sources
        where project_id = p_project_id and content_hash = p_content_hash and deleted_at is null
     ) then
    raise exception 'duplicate_content' using errcode = 'KF409';
  end if;

  return public.enqueue_job(p_project_id, 'pdf', btrim(p_title), null, p_storage_path, p_content_hash, p_idempotency_key, p_request_hash);
end;
$$;

revoke all on function public.register_pdf_source(uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_pdf_source(uuid, text, text, text, text, text) to authenticated;
