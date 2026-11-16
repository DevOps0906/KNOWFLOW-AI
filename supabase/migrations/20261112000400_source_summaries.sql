-- task-029a: 영상 단위 요약(구현 결정 1). source_summaries(자료 1:1) + service_role RPC save_source_summary,
-- replace_source_chunks 재정의(같은 트랜잭션에서 그 자료의 요약을 지운다 — 재처리 시 낡은 인용 차단).
-- 요약 문장의 chunk_ids는 저장 시점에 그 자료의 청크여야 하고, 청크가 바뀌면 요약은 지워진다.

-- 1) source_summaries -----------------------------------------------------------
create table public.source_summaries (
  source_id uuid primary key,
  project_id uuid not null,
  user_id uuid not null,
  -- 요약을 만든 source_ingest 작업(기록용, 작업 행 정리와 무관하게 남긴다)
  job_id uuid not null,
  -- [{"text": 1~1000자, "chunk_ids": [그 자료의 청크 id 1~20개]}] 1~50문장. 형식 검사는 save_source_summary가 한다
  sentences jsonb not null check (jsonb_typeof(sentences) = 'array' and jsonb_array_length(sentences) between 1 and 50),
  model text not null check (char_length(btrim(model)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
alter table public.source_summaries enable row level security;
create index source_summaries_user_id_idx on public.source_summaries (user_id);
create index source_summaries_project_id_idx on public.source_summaries (project_id);

comment on table public.source_summaries is
  '유튜브 영상 단위 요약(자료 1:1). 문장마다 그 자료의 청크 인용. 청크 교체 시 삭제(task-029a)';

grant select on public.source_summaries to authenticated;
-- 소유자만, 자료가 보이고(sources RLS: 미삭제·프로젝트 미삭제) 비활성(unavailable_at)이 아닐 때만. 쓰기 권한은 없다
create policy source_summaries_select_own on public.source_summaries for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.sources s where s.id = source_summaries.source_id and s.unavailable_at is null)
  );

-- 2) save_source_summary ----------------------------------------------------------
-- 영상 요약 저장(upsert). Worker(service_role) 전용, 완료 뒤 후행 단계에서 부른다.
-- 저장 조건: p_job_id가 그 자료의 가장 최근에 끝난(finished_at) succeeded source_ingest 작업이고,
--   자료가 미삭제·비활성 아님이고, 모든 chunk_id가 지금 그 자료의 청크일 때. 아니면 false(아무것도 바꾸지 않음).
-- 자료 행을 잠가(FOR NO KEY UPDATE) replace_source_chunks와 직렬화한다: 청크 교체가 먼저면 이 함수가 기다린 뒤 거부하고,
--   이 함수가 먼저면 청크 교체가 기다린 뒤 요약을 지운다.
-- 문장 형식: [{"text": 공백 제외 1~1000자, "chunk_ids": 소문자 UUID 문자열 1~20개}] 1~50개. text는 앞뒤 공백을 지워 저장한다.
-- 오류 코드(SQLSTATE): 22023 형식 오류(invalid_summary)·모델명 오류·youtube 아닌 자료(not_youtube_source)
create function public.save_source_summary(p_job_id uuid, p_sentences jsonb, p_model text) returns boolean
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
  if v_source.source_type <> 'youtube' then
    raise exception 'not_youtube_source' using errcode = '22023';
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
  '영상 요약을 최신 완료 작업·현재 청크 기준으로 저장한다. Worker 전용(task-029a)';

revoke all on function public.save_source_summary(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_source_summary(uuid, jsonb, text) to service_role;

-- 3) replace_source_chunks 재정의 ------------------------------------------------
-- 20261111000400 그대로이고, 비활성 자료는 거부(false)하며, 자료 행을 잠근 뒤(save_source_summary와 직렬화) 청크와 함께 그 자료의 요약을 지운다.
create or replace function public.replace_source_chunks(p_job_id uuid, p_attempt integer, p_chunks jsonb) returns boolean
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

  -- 삭제된 자료에는 청크를 쓰지 않는다(소프트 삭제 뒤 영구 삭제 순서를 지키기 위해).
  -- 비활성(unavailable_at: 권리자 삭제·재확인 비공개) 자료에도 쓰지 않는다(진행 중이던 수집이 삭제된 청크를 되살리지 않게).
  -- 행 잠금으로 save_source_summary·takedown_video의 sources UPDATE와 직렬화한다(작업 → 자료 순서로 잠근다)
  select project_id into v_project_id from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for no key update;
  if not found then
    return false;
  end if;

  delete from public.source_summaries where source_id = v_job.source_id;
  delete from public.source_chunks where source_id = v_job.source_id;
  insert into public.source_chunks (source_id, project_id, chunk_index, content, locator)
  select v_job.source_id, v_project_id, (e ->> 'chunk_index')::integer, e ->> 'content', e -> 'locator'
    from jsonb_array_elements(p_chunks) e;
  return true;
end;
$$;

comment on function public.replace_source_chunks(uuid, integer, jsonb) is
  '자료 청크를 (job_id, attempt) 펜싱 아래 통째로 교체하고 그 자료의 영상 요약을 지운다. Worker 전용(task-011·029a)';
