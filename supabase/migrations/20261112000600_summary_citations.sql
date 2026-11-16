-- task-029b: save_source_summary 재정의(000400 본문 + 문장별 citations [{chunk_id, t_start}] 저장).
-- 요약 인용의 mm:ss를 읽을 때 source_chunks를 다시 훑지 않도록 저장 시점에 청크 locator.t_start를 함께 둔다.
-- 잠금·검증·권한은 그대로(revoke/grant 재선언).
create or replace function public.save_source_summary(p_job_id uuid, p_sentences jsonb, p_model text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_project_id uuid;
  v_latest uuid;
  v_user_id uuid;
  v_with_citations jsonb;
begin
  if p_model is null or char_length(btrim(p_model)) not between 1 and 100
     or p_sentences is null or jsonb_typeof(p_sentences) <> 'array' or jsonb_array_length(p_sentences) not between 1 and 50 then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sentences) e
     where jsonb_typeof(e) is distinct from 'object'
        or jsonb_typeof(e -> 'text') is distinct from 'string'
        or char_length(btrim(e ->> 'text')) not between 1 and 1000
        or jsonb_typeof(e -> 'chunk_ids') is distinct from 'array'
        -- 배열일 때만 길이·원소를 본다(OR는 평가 순서를 보장하지 않는다)
        or case when jsonb_typeof(e -> 'chunk_ids') = 'array'
                then jsonb_array_length(e -> 'chunk_ids') not between 1 and 20
                  or exists (
                    select 1 from jsonb_array_elements(e -> 'chunk_ids') c
                     where jsonb_typeof(c) <> 'string'
                        or (c #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  )
                else true end
  ) then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and job_type = 'source_ingest' and status = 'succeeded' and source_id is not null;
  if not found then
    return false;
  end if;

  -- 같은 자료의 더 늦은 완료 작업이 있으면(재처리) 이 작업의 요약은 낡았다
  select id into v_latest from public.processing_jobs
   where source_id = v_job.source_id and job_type = 'source_ingest' and status = 'succeeded'
   order by finished_at desc nulls last, created_at desc, id desc limit 1;
  if v_latest is distinct from p_job_id then
    return false;
  end if;

  -- 자료 행 잠금(잠금 순서 job → source): takedown_video·replace_source_chunks와 직렬화. user_id는 sources 기준
  select project_id, user_id into v_project_id, v_user_id from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for update;
  if not found then
    return false;
  end if;

  -- 모든 chunk_id가 지금 그 자료의 청크여야 한다
  if exists (
    select 1
      from jsonb_array_elements(p_sentences) e, jsonb_array_elements_text(e -> 'chunk_ids') c
     where not exists (
       select 1 from public.source_chunks k where k.id = c::uuid and k.source_id = v_job.source_id
     )
  ) then
    return false;
  end if;

  -- 문장마다 citations [{chunk_id, t_start}]를 함께 저장한다(시각은 그 자료 청크 locator.t_start, 숫자일 때만). chunk_ids는 그대로 둔다
  select jsonb_agg(
           e || jsonb_build_object('citations', coalesce((
             select jsonb_agg(jsonb_build_object('chunk_id', k.id, 't_start', k.locator -> 't_start') order by c.ord)
               from jsonb_array_elements_text(e -> 'chunk_ids') with ordinality as c(id, ord)
               join public.source_chunks k on k.id = c.id::uuid and k.source_id = v_job.source_id
              where jsonb_typeof(k.locator -> 't_start') = 'number'
           ), '[]'::jsonb))
           order by t.o)
    into v_with_citations
    from jsonb_array_elements(p_sentences) with ordinality as t(e, o);

  insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
  values (v_job.source_id, v_project_id, v_user_id, p_job_id, v_with_citations, btrim(p_model))
  on conflict (source_id) do update
    set job_id = excluded.job_id, sentences = excluded.sentences, model = excluded.model, created_at = now();
  return true;
end;
$$;

comment on function public.save_source_summary(uuid, jsonb, text) is
  '영상 요약 저장. 최신 완료 source_ingest 작업·현재 청크 인용만 허용. Worker 전용(task-029a)';

revoke all on function public.save_source_summary(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_source_summary(uuid, jsonb, text) to service_role;

