-- task-029a: 영상 요약 저장(source_summaries) + save_source_summary RPC + replace_source_chunks 재정의(요약 삭제).
-- 1) source_summaries: 자료당 1행. RLS 소유자 읽기만(sources와 같은 미삭제·unavailable_at is null 조건). 쓰기 권한 없음.
-- 2) save_source_summary(service_role 전용): 그 자료의 최신 완료 source_ingest 작업이고 모든 chunk_id가 지금 그 자료의 청크일 때만 저장.
-- 3) replace_source_chunks 재정의: 20261111000400 본문 그대로 + 같은 트랜잭션에서 그 자료의 요약 삭제(재처리 시 낡은 인용 차단).
create table public.source_summaries (
  source_id uuid primary key,
  project_id uuid not null,
  user_id uuid not null,
  job_id uuid not null,
  sentences jsonb not null check (jsonb_typeof(sentences) = 'array' and jsonb_array_length(sentences) between 1 and 50
    and pg_column_size(sentences) <= 100000), -- 문장 text 1~1000자는 RPC가 검증(CHECK는 하위 쿼리 불가)
  model text not null check (char_length(btrim(model)) between 1 and 100),
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
alter table public.source_summaries enable row level security;
create index source_summaries_user_id_idx on public.source_summaries (user_id);
create index source_summaries_project_id_idx on public.source_summaries (project_id);

comment on table public.source_summaries is
  '영상 자료 요약. sentences = [{text, chunk_ids[]}], 인용은 저장 시점의 그 자료 청크만. 재처리 때 replace_source_chunks가 지운다(task-029a)';

grant select on public.source_summaries to authenticated;
create policy source_summaries_select_own on public.source_summaries for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.sources s where s.id = source_summaries.source_id and s.unavailable_at is null)
  );

-- 2) save_source_summary ------------------------------------------------------
-- 오류 코드(SQLSTATE): 22023 형식 오류(sentences 1~50개, 각 {text 비어 있지 않은 문자열, chunk_ids 1개 이상 UUID 문자열 배열}, model 비어 있지 않음).
-- 거부(작업 없음·최신 완료 작업 아님·삭제/비활성 자료·현재 청크가 아닌 chunk_id)는 false.
create function public.save_source_summary(p_job_id uuid, p_sentences jsonb, p_model text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_project_id uuid;
  v_latest uuid;
  v_user_id uuid;
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

  insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
  values (v_job.source_id, v_project_id, v_user_id, p_job_id, p_sentences, btrim(p_model))
  on conflict (source_id) do update
    set job_id = excluded.job_id, sentences = excluded.sentences, model = excluded.model, created_at = now();
  return true;
end;
$$;

comment on function public.save_source_summary(uuid, jsonb, text) is
  '영상 요약 저장. 최신 완료 source_ingest 작업·현재 청크 인용만 허용. Worker 전용(task-029a)';

revoke all on function public.save_source_summary(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_source_summary(uuid, jsonb, text) to service_role;

-- 3) replace_source_chunks 재정의 (20261111000400 + 요약 삭제) -------------------
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
  if (select count(distinct (e ->> 'chunk_index')::numeric) <> count(*) from jsonb_array_elements(p_chunks) e) then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest'
   for update;
  if not found then
    return false;
  end if;

  -- 삭제·비활성(unavailable_at) 자료에는 쓰지 않는다. 자료 행을 잠가 takedown_video(같은 행 update)와 직렬화한다
  select project_id into v_project_id from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for update;
  if not found then
    return false;
  end if;

  -- 청크 ID가 바뀌므로 낡은 인용을 가진 요약을 같은 트랜잭션에서 지운다
  delete from public.source_summaries where source_id = v_job.source_id;
  delete from public.source_chunks where source_id = v_job.source_id;
  insert into public.source_chunks (source_id, project_id, chunk_index, content, locator)
  select v_job.source_id, v_project_id, (e ->> 'chunk_index')::integer, e ->> 'content', e -> 'locator'
    from jsonb_array_elements(p_chunks) e;
  return true;
end;
$$;

comment on function public.replace_source_chunks(uuid, integer, jsonb) is
  '자료 청크를 (job_id, attempt) 펜싱 아래 통째로 교체하고 그 자료의 요약을 지운다. Worker 전용(task-011, task-029a)';

revoke all on function public.replace_source_chunks(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.replace_source_chunks(uuid, integer, jsonb) to service_role;
