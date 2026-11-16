-- KNOWFLOW AI · org안 task-029: 영상 요약(source_summaries·save_source_summary) + 권리자 삭제 요청 처리(takedown_video).
-- 원본: KNOWFLOW-AI task-029 구현 결정 1·7(미적용 초안 20261112000400·20261112000500)을 nomad_knowflow·organization_id 기준으로 옮겼다.
-- 1) source_summaries: 유튜브 자료 1:1 요약. 읽기 = 조직 멤버, 자료가 보이고(미삭제) unavailable_at is null일 때만. 쓰기는 RPC만.
-- 2) save_source_summary(job, 문장, 모델): service_role(Worker) 전용. 그 자료의 최신 완료 source_ingest 작업이고 인용 청크가 모두 지금 그 자료의 청크일 때만 저장.
-- 3) replace_source_chunks 재정의: 자료 행을 잠그고 같은 트랜잭션에서 그 자료의 요약을 지운다(재처리 시 낡은 인용 차단).
--    replace_source_chunks·replace_source_moments는 자료가 비활성(unavailable_at)이면 false(아무것도 바꾸지 않음):
--    takedown 뒤 진행 중이던 작업이 청크·장면·요약을 되살리지 못하게 한다(takedown의 update와 자료 행 잠금으로 직렬화).
-- 4) takedown_video(video_id, 사유): service_role(운영자) 전용. 모든 조직의 해당 video_id 자료 비활성 + 청크·장면·요약 삭제 + nomad_core.write_audit 기록.
-- 전제: 0001_knowflow.sql · nomad_core.write_audit(코어 감사 로그).
-- 되돌림: drop function nomad_knowflow.takedown_video(text, text), nomad_knowflow.save_source_summary(uuid, jsonb, text);
--   drop table nomad_knowflow.source_summaries; replace_source_chunks·replace_source_moments는 0001 정의로 다시 만든다.
begin;

-- ===== 1) source_summaries =====
create table nomad_knowflow.source_summaries (
  source_id uuid primary key,
  project_id uuid not null,
  organization_id uuid not null,
  -- 요약을 만든 source_ingest 작업(기록용. 작업 행 정리와 무관하게 남긴다)
  job_id uuid not null,
  -- [{"text": 1~1000자, "chunk_ids": [그 자료의 청크 id 1~20개]}] 1~50문장. 형식 검사는 save_source_summary가 한다
  sentences jsonb not null check (jsonb_typeof(sentences) = 'array' and jsonb_array_length(sentences) between 1 and 50),
  model text not null check (char_length(btrim(model)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references nomad_knowflow.sources (id, project_id) on delete cascade,
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade
);
comment on table nomad_knowflow.source_summaries is '유튜브 영상 단위 요약(자료 1:1). 문장마다 그 자료의 청크 인용. 청크 교체·권리자 삭제 시 삭제(task-029)';
alter table nomad_knowflow.source_summaries enable row level security;
create index source_summaries_organization_id_idx on nomad_knowflow.source_summaries (organization_id);
create index source_summaries_project_id_idx on nomad_knowflow.source_summaries (project_id);

revoke all on nomad_knowflow.source_summaries from public, anon, authenticated, service_role;
grant select on nomad_knowflow.source_summaries to authenticated, service_role;
-- 조직 멤버만, 자료가 보이고(sources RLS: 미삭제·프로젝트 미삭제) 비활성이 아닐 때만. 쓰기 정책 없음(RPC만)
create policy source_summaries_select_org on nomad_knowflow.source_summaries for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null
    and exists (select 1 from nomad_knowflow.sources s where s.id = source_summaries.source_id and s.unavailable_at is null));

-- ===== 2) save_source_summary =====
-- 영상 요약 저장(upsert). Worker(service_role) 전용, 작업 완료 뒤 후행 단계에서 부른다.
-- 저장 조건: p_job_id가 그 자료의 가장 늦게 끝난 succeeded source_ingest 작업, 자료가 미삭제·비활성 아님,
--   모든 chunk_id가 지금 그 자료의 청크. 아니면 false(아무것도 바꾸지 않음).
-- 자료 행을 잠가(for no key update) replace_source_chunks와 직렬화한다.
-- 오류(SQLSTATE 22023): invalid_summary(형식·모델명) · not_youtube_source
create function nomad_knowflow.save_source_summary(p_job_id uuid, p_sentences jsonb, p_model text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_source nomad_knowflow.sources;
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
        or jsonb_typeof(e -> 'text') is distinct from 'string'
        or char_length(btrim(e ->> 'text')) not between 1 and 1000
        -- 길이·요소 검사는 배열일 때만 한다(OR는 평가 순서를 보장하지 않는다)
        or case when jsonb_typeof(e -> 'chunk_ids') = 'array'
                then jsonb_array_length(e -> 'chunk_ids') not between 1 and 20
                  or exists (
                    select 1 from jsonb_array_elements(e -> 'chunk_ids') c
                     where jsonb_typeof(c) <> 'string'
                        or (c #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                else true end
  ) then raise exception 'invalid_summary' using errcode = '22023'; end if;

  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and job_type = 'source_ingest' and status = 'succeeded';
  if not found then return false; end if;

  select * into v_source from nomad_knowflow.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for no key update;
  if not found then return false; end if;
  if v_source.source_type <> 'youtube' then raise exception 'not_youtube_source' using errcode = '22023'; end if;

  -- 더 늦게 끝난 succeeded source_ingest 작업이 있으면 낡은 작업이다
  if exists (
    select 1 from nomad_knowflow.processing_jobs j
     where j.source_id = v_source.id and j.job_type = 'source_ingest' and j.status = 'succeeded' and j.id <> v_job.id
       and (j.finished_at, j.id) > (v_job.finished_at, v_job.id)
  ) then return false; end if;

  if exists (
    select 1 from jsonb_array_elements(p_sentences) e, jsonb_array_elements_text(e -> 'chunk_ids') c
     where not exists (select 1 from nomad_knowflow.source_chunks sc where sc.id = c::uuid and sc.source_id = v_source.id)
  ) then return false; end if;

  insert into nomad_knowflow.source_summaries (source_id, project_id, organization_id, job_id, sentences, model)
  select v_source.id, v_source.project_id, v_source.organization_id, v_job.id,
         jsonb_agg(jsonb_build_object('text', btrim(e ->> 'text'), 'chunk_ids', e -> 'chunk_ids') order by n),
         btrim(p_model)
    from jsonb_array_elements(p_sentences) with ordinality as t(e, n)
  on conflict (source_id) do update
     set job_id = excluded.job_id, sentences = excluded.sentences, model = excluded.model, created_at = now();
  return true;
end;
$$;
comment on function nomad_knowflow.save_source_summary(uuid, jsonb, text) is
  '영상 요약을 최신 완료 작업·현재 청크 기준으로 저장한다. Worker(service_role) 전용(task-029)';

-- ===== 3) replace_source_chunks 재정의 =====
-- 0001 정의와 같고, 자료 행을 잠근 뒤(save_source_summary·takedown_video와 직렬화) 청크와 함께 그 자료의 요약을 지운다.
-- 자료가 삭제됐거나 비활성(unavailable_at, 권리자 삭제 등)이면 false.
-- create or replace라 기존 EXECUTE 권한(service_role)은 그대로다.
create or replace function nomad_knowflow.replace_source_chunks(p_job_id uuid, p_attempt integer, p_chunks jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_project_id uuid;
begin
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 20000 then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_chunks) e
     where jsonb_typeof(e) <> 'object'
        or case when jsonb_typeof(e -> 'chunk_index') = 'number'
                then (e ->> 'chunk_index')::numeric <> trunc((e ->> 'chunk_index')::numeric)
                  or (e ->> 'chunk_index')::numeric not between 0 and 2147483647
                else true end
        or jsonb_typeof(e -> 'content') <> 'string'
        or char_length(e ->> 'content') = 0
        or jsonb_typeof(e -> 'locator') <> 'object'
  ) then raise exception 'invalid_chunks' using errcode = '22023'; end if;
  if (select count(distinct (e ->> 'chunk_index')::numeric) <> count(*) from jsonb_array_elements(p_chunks) e) then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest' for update;
  if not found then return false; end if;
  -- 작업 → 자료 순서로 잠근다(save_source_summary·takedown_video와 직렬화). 비활성 자료는 거부
  select project_id into v_project_id from nomad_knowflow.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null for no key update;
  if not found then return false; end if;
  delete from nomad_knowflow.source_summaries where source_id = v_job.source_id;
  delete from nomad_knowflow.source_chunks where source_id = v_job.source_id;
  insert into nomad_knowflow.source_chunks (source_id, project_id, chunk_index, content, locator)
  select v_job.source_id, v_project_id, (e ->> 'chunk_index')::integer, e ->> 'content', e -> 'locator'
    from jsonb_array_elements(p_chunks) e;
  return true;
end;
$$;
comment on function nomad_knowflow.replace_source_chunks(uuid, integer, jsonb) is
  '자료 청크를 (job_id, attempt) 펜싱 아래 통째로 교체하고 그 자료의 영상 요약을 지운다. Worker 전용(task-011·029)';

-- ===== 3b) replace_source_moments 재정의 =====
-- 0001 정의와 같고, 자료 행을 잠그며 비활성(unavailable_at) 자료면 false(takedown 뒤 장면 재생성 차단).
-- create or replace라 기존 EXECUTE 권한(service_role)은 그대로다.
create or replace function nomad_knowflow.replace_source_moments(p_job_id uuid, p_attempt integer, p_moments jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_source nomad_knowflow.sources;
begin
  if p_moments is null or jsonb_typeof(p_moments) <> 'array' or jsonb_array_length(p_moments) > 500 then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_moments) e
     where jsonb_typeof(e) <> 'object'
        or case when jsonb_typeof(e -> 'moment_index') = 'number'
                then (e ->> 'moment_index')::numeric <> trunc((e ->> 'moment_index')::numeric)
                  or (e ->> 'moment_index')::numeric not between 0 and 2147483647
                else true end
        or jsonb_typeof(e -> 'locator') <> 'object'
        or case when jsonb_typeof(e -> 'locator' -> 't_start') = 'number' and jsonb_typeof(e -> 'locator' -> 't_end') = 'number'
                then (e -> 'locator' ->> 't_start')::numeric < 0
                  or (e -> 'locator' ->> 't_end')::numeric <= (e -> 'locator' ->> 't_start')::numeric
                else true end
        or jsonb_typeof(e -> 'title') <> 'string'
        or char_length(btrim(e ->> 'title')) not between 1 and 200
        or jsonb_typeof(e -> 'description') <> 'string'
        or char_length(btrim(e ->> 'description')) not between 1 and 2000
  ) then raise exception 'invalid_moments' using errcode = '22023'; end if;
  if (select count(distinct (e ->> 'moment_index')::numeric) <> count(*) from jsonb_array_elements(p_moments) e) then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest' for update;
  if not found then return false; end if;
  -- 작업 → 자료 순서로 잠근다(takedown_video와 직렬화). 비활성 자료는 거부
  select * into v_source from nomad_knowflow.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null for no key update;
  if not found then return false; end if;
  if v_source.source_type <> 'youtube' then raise exception 'not_youtube_source' using errcode = '22023'; end if;
  if v_source.duration_seconds is not null and exists (
    select 1 from jsonb_array_elements(p_moments) e where (e -> 'locator' ->> 't_end')::numeric > v_source.duration_seconds
  ) then raise exception 'invalid_moments' using errcode = '22023'; end if;
  delete from nomad_knowflow.source_moments where source_id = v_source.id;
  insert into nomad_knowflow.source_moments (source_id, project_id, organization_id, moment_index, locator, title, description)
  select v_source.id, v_source.project_id, v_source.organization_id, (e ->> 'moment_index')::integer,
         jsonb_build_object('t_start', e -> 'locator' -> 't_start', 't_end', e -> 'locator' -> 't_end'),
         btrim(e ->> 'title'), btrim(e ->> 'description')
    from jsonb_array_elements(p_moments) e;
  return true;
end;
$$;
comment on function nomad_knowflow.replace_source_moments(uuid, integer, jsonb) is
  '유튜브 장면 카드를 (job_id, attempt) 펜싱 아래 통째로 교체한다. 비활성 자료는 거부. Worker 전용(task-011·029)';

-- ===== 4) takedown_video =====
-- 권리자 삭제 요청 처리(운영 절차: KNOWFLOW-AI docs/runbooks/rights-takedown.md). 소프트 삭제된 자료도 포함한다.
-- 메타데이터(제목·채널·길이)는 다음 재확인 스윕이 비활성 자료 기준으로 파기한다.
-- 감사: nomad_core.write_audit(조직 null = 운영 전역 기록, action 'knowflow.rights_takedown', 대상 video_id, metadata에 사유·건수).
-- 같은 video_id로 다시 실행해도 된다(이미 비활성인 시각은 유지, 남은 청크·장면·요약을 다시 지우고 기록을 하나 더 남긴다).
-- 반환: {"sources", "chunks_deleted", "moments_deleted", "summaries_deleted", "active_jobs"}. active_jobs가 0이 아니면 작업이 끝난 뒤 다시 실행한다.
-- 오류(SQLSTATE 22023): invalid_video_id(11자 형식) · invalid_reason(공백 아닌 1~1000자)
create function nomad_knowflow.takedown_video(p_video_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_sources integer; v_chunks integer; v_moments integer; v_summaries integer; v_active integer; v_result jsonb;
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid_video_id' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  update nomad_knowflow.sources set unavailable_at = coalesce(unavailable_at, now()) where video_id = p_video_id;
  get diagnostics v_sources = row_count;

  delete from nomad_knowflow.source_chunks c using nomad_knowflow.sources s
   where s.id = c.source_id and s.video_id = p_video_id;
  get diagnostics v_chunks = row_count;

  delete from nomad_knowflow.source_moments m using nomad_knowflow.sources s
   where s.id = m.source_id and s.video_id = p_video_id;
  get diagnostics v_moments = row_count;

  delete from nomad_knowflow.source_summaries ss using nomad_knowflow.sources s
   where s.id = ss.source_id and s.video_id = p_video_id;
  get diagnostics v_summaries = row_count;

  select count(*) into v_active
    from nomad_knowflow.processing_jobs j join nomad_knowflow.sources s on s.id = j.source_id
   where s.video_id = p_video_id and j.job_type = 'source_ingest' and j.status in ('queued', 'running');

  v_result := jsonb_build_object('sources', v_sources, 'chunks_deleted', v_chunks, 'moments_deleted', v_moments,
                                 'summaries_deleted', v_summaries, 'active_jobs', v_active);
  perform nomad_core.write_audit(null, 'knowflow.rights_takedown', 'youtube_video', p_video_id, null, null,
                                 v_result || jsonb_build_object('reason', btrim(p_reason)));
  return v_result;
end;
$$;
comment on function nomad_knowflow.takedown_video(text, text) is
  '권리자 삭제 요청 처리(task-029). 해당 video_id의 모든 자료 비활성 + 청크·장면·요약 삭제 + 감사 기록. service_role 전용';

revoke execute on function
  nomad_knowflow.save_source_summary(uuid, jsonb, text), nomad_knowflow.takedown_video(text, text)
from public, anon, authenticated, service_role;
grant execute on function
  nomad_knowflow.save_source_summary(uuid, jsonb, text), nomad_knowflow.takedown_video(text, text)
to service_role;

commit;
