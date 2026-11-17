-- PDF 자료 요약: save_source_summary가 PDF 자료도 받도록 재정의한다(20261112000400 원본 그대로이고 자료 유형 검사만 바꾼다).
-- url 자료는 계속 거부(22023 unsupported_summary_source). security definer·search_path=''·권한(service_role 전용)은 원본과 같다.
-- usage_events.event_type은 제약 없는 text라 PDF 자료 요약 사용 기록('source_summary')을 위해 바꿀 것이 없다. 백필은 하지 않는다.

comment on table public.source_summaries is
  '자료 단위 요약(유튜브·PDF, 자료 1:1). 문장마다 그 자료의 청크 인용. 청크 교체 시 삭제(task-029a)';

-- 영상·PDF 자료 요약 저장(upsert). Worker(service_role) 전용, 완료 뒤 후행 단계에서 부른다.
-- 저장 조건: p_job_id가 그 자료의 가장 최근에 끝난(finished_at) succeeded source_ingest 작업이고,
--   자료가 미삭제·비활성 아님이고, 모든 chunk_id가 지금 그 자료의 청크일 때. 아니면 false(아무것도 바꾸지 않음).
-- 자료 행을 잠가(FOR NO KEY UPDATE) replace_source_chunks와 직렬화한다.
-- 오류 코드(SQLSTATE): 22023 형식 오류(invalid_summary)·모델명 오류·유튜브/PDF 아닌 자료(unsupported_summary_source)
create or replace function public.save_source_summary(p_job_id uuid, p_sentences jsonb, p_model text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_source public.sources;
begin
  if p_model is null or char_length(btrim(p_model)) not between 1 and 200 then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;
  if p_sentences is null or jsonb_typeof(p_sentences) <> 'array' or jsonb_array_length(p_sentences) not between 1 and 50 then
    raise exception 'invalid_summary' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sentences) e
     where jsonb_typeof(e) <> 'object'
        -- 키가 없으면 jsonb_typeof가 NULL이라 비교가 NULL이 된다(필수 키는 coalesce로 거부)
        or coalesce(jsonb_typeof(e -> 'text'), '') <> 'string'
        or char_length(btrim(e ->> 'text')) not between 1 and 1000
        or coalesce(jsonb_typeof(e -> 'chunk_ids'), '') <> 'array'
        -- 길이·요소 검사는 배열일 때만 한다(OR는 평가 순서를 보장하지 않는다)
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
   where id = p_job_id and job_type = 'source_ingest' and status = 'succeeded';
  if not found then
    return false;
  end if;

  select * into v_source from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for no key update;
  if not found then
    return false;
  end if;
  -- 유튜브·PDF만 요약한다(url은 본문 추출 연결 전이라 거부)
  if v_source.source_type not in ('youtube', 'pdf') then
    raise exception 'unsupported_summary_source' using errcode = '22023';
  end if;

  -- 더 늦게 끝난 succeeded source_ingest 작업이 있으면 낡은 작업이다
  if exists (
    select 1 from public.processing_jobs j
     where j.source_id = v_source.id and j.job_type = 'source_ingest' and j.status = 'succeeded' and j.id <> v_job.id
       and (j.finished_at, j.id) > (v_job.finished_at, v_job.id)
  ) then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sentences) e, jsonb_array_elements_text(e -> 'chunk_ids') c
     where not exists (select 1 from public.source_chunks sc where sc.id = c::uuid and sc.source_id = v_source.id)
  ) then
    return false;
  end if;

  insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
  select v_source.id, v_source.project_id, v_source.user_id, v_job.id,
         jsonb_agg(jsonb_build_object('text', btrim(e ->> 'text'), 'chunk_ids', e -> 'chunk_ids') order by n),
         btrim(p_model)
    from jsonb_array_elements(p_sentences) with ordinality as t(e, n)
  on conflict (source_id) do update
     set job_id = excluded.job_id, sentences = excluded.sentences, model = excluded.model, created_at = now();
  return true;
end;
$$;

comment on function public.save_source_summary(uuid, jsonb, text) is
  '자료(유튜브·PDF) 요약을 최신 완료 작업·현재 청크 기준으로 저장한다. Worker 전용(task-029a·PDF 자료 요약)';

revoke all on function public.save_source_summary(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_source_summary(uuid, jsonb, text) to service_role;
