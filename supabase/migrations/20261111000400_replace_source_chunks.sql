-- task-011: 펜싱된 청크 교체 RPC(구현 결정 8). Worker(service_role) 전용.
-- processing_jobs 행을 (id, attempt_count, status='running')으로 FOR UPDATE 잠근 트랜잭션에서 기존 청크를 지우고 새 청크를 넣는다.
-- 같은 자료를 다시 처리해도 청크가 중복되지 않고, 오래된 시도(attempt 불일치)·끝난 작업의 쓰기는 false로 거부된다.
-- Worker는 같은 트랜잭션에서 complete_job까지 부른다. embedding_model은 벡터 저장(task-013) 때만 채우므로 여기서는 NULL.
-- 삭제된 자료(deleted_at)면 false. content_tsv는 생성 컬럼이라 쓰지 않는다.
-- 오류 코드(SQLSTATE): 22023 청크 형식 오류(객체·chunk_index 0 이상 정수·배열 내 유일·content 비어 있지 않음·locator 객체).
create function public.replace_source_chunks(p_job_id uuid, p_attempt integer, p_chunks jsonb) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_project_id uuid;
begin
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 20000 then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_chunks) e
     where jsonb_typeof(e) <> 'object'
        -- 캐스트는 숫자일 때만 한다(OR는 평가 순서를 보장하지 않는다)
        or case when jsonb_typeof(e -> 'chunk_index') = 'number'
                then (e ->> 'chunk_index')::numeric <> trunc((e ->> 'chunk_index')::numeric)
                  or (e ->> 'chunk_index')::numeric not between 0 and 2147483647
                else true end
        or jsonb_typeof(e -> 'content') <> 'string'
        or char_length(e ->> 'content') = 0
        or jsonb_typeof(e -> 'locator') <> 'object'
  ) then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  -- chunk_index는 배열 안에서 유일해야 한다(unique 위반 23505 대신 형식 오류로 돌려준다)
  if (select count(distinct (e ->> 'chunk_index')::numeric) <> count(*) from jsonb_array_elements(p_chunks) e) then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest'
   for update;
  if not found then
    return false;
  end if;

  -- 삭제된 자료에는 청크를 쓰지 않는다(소프트 삭제 뒤 영구 삭제 순서를 지키기 위해)
  select project_id into v_project_id from public.sources where id = v_job.source_id and deleted_at is null;
  if not found then
    return false;
  end if;

  delete from public.source_chunks where source_id = v_job.source_id;
  insert into public.source_chunks (source_id, project_id, chunk_index, content, locator)
  select v_job.source_id, v_project_id, (e ->> 'chunk_index')::integer, e ->> 'content', e -> 'locator'
    from jsonb_array_elements(p_chunks) e;
  return true;
end;
$$;

comment on function public.replace_source_chunks(uuid, integer, jsonb) is
  '자료 청크를 (job_id, attempt) 펜싱 아래 통째로 교체한다. Worker 전용(task-011)';

revoke all on function public.replace_source_chunks(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.replace_source_chunks(uuid, integer, jsonb) to service_role;
