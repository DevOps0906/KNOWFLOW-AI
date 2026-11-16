-- task-029c: 권리자 삭제 요청 처리(task-029 구현 결정 7, 런북 docs/runbooks/rights-takedown.md).
-- 1) rights_takedowns: 처리 감사 기록. RLS 전체 거부, 역할 권한 없음(운영자는 SQL 편집기·postgres로만 읽는다)
-- 2) takedown_video(p_video_id, p_reason): service_role(운영자) 전용. 모든 사용자의 해당 video_id 자료를 비활성(unavailable_at)으로 바꾸고
--    청크·장면·요약(source_summaries가 있으면)을 지운 뒤 감사 기록을 남긴다. 소프트 삭제된 자료도 포함한다.
--    메타데이터(제목·채널·길이)는 다음 재확인 스윕이 비활성 자료 기준으로 파기한다(027d).
-- 3) replace_source_moments 재정의: 비활성 자료 거부(replace_source_chunks는 20261112000400에서 같은 조건) — 진행 중 수집의 재삽입 차단
-- 4) register_youtube_source 재정의: rights_takedowns에 있는 video_id 등록 거부(KF451 video_taken_down)
-- 오류 코드(SQLSTATE): 22023 잘못된 video_id(11자 형식) 또는 사유(공백 아닌 1~1000자)
-- 같은 video_id로 다시 실행해도 된다(이미 비활성인 시각은 유지, 남은 청크·장면을 다시 지우고 기록을 하나 더 남긴다).

-- 1) rights_takedowns ------------------------------------------------------------
create table public.rights_takedowns (
  id uuid primary key default gen_random_uuid(),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  sources_count integer not null check (sources_count >= 0),
  chunks_deleted integer not null check (chunks_deleted >= 0),
  moments_deleted integer not null check (moments_deleted >= 0),
  summaries_deleted integer not null check (summaries_deleted >= 0),
  -- 실행 시점에 진행 중(queued·running)이던 수집 작업 수. 0이 아니면 작업이 끝난 뒤 다시 실행한다(런북 3단계)
  active_jobs integer not null check (active_jobs >= 0),
  created_at timestamptz not null default now()
);
alter table public.rights_takedowns enable row level security;
create index rights_takedowns_video_id_idx on public.rights_takedowns (video_id);

comment on table public.rights_takedowns is
  '권리자 삭제 요청 처리 감사 기록(029c). takedown_video만 쓴다. 사용자·Worker 접근 없음, 보존 기간은 런북';

create policy rights_takedowns_deny_all on public.rights_takedowns for all to anon, authenticated
  using (false) with check (false);
revoke all on public.rights_takedowns from public, anon, authenticated, service_role;

-- 2) takedown_video ----------------------------------------------------------------
-- 반환: {"sources", "chunks_deleted", "moments_deleted", "summaries_deleted", "active_jobs"}
create function public.takedown_video(p_video_id text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sources integer;
  v_chunks integer;
  v_moments integer;
  v_summaries integer := 0;
  v_active integer;
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid_video_id' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  update public.sources
     set unavailable_at = coalesce(unavailable_at, now())
   where video_id = p_video_id;
  get diagnostics v_sources = row_count;

  delete from public.source_chunks c
   using public.sources s
   where s.id = c.source_id and s.video_id = p_video_id;
  get diagnostics v_chunks = row_count;

  delete from public.source_moments m
   using public.sources s
   where s.id = m.source_id and s.video_id = p_video_id;
  get diagnostics v_moments = row_count;

  -- 영상 요약 테이블은 task-029a가 만든다. 없으면 건너뛴다
  if to_regclass('public.source_summaries') is not null then
    execute 'delete from public.source_summaries ss using public.sources s where s.id = ss.source_id and s.video_id = $1'
      using p_video_id;
    get diagnostics v_summaries = row_count;
  end if;

  select count(*) into v_active
    from public.processing_jobs j join public.sources s on s.id = j.source_id
   where s.video_id = p_video_id and j.job_type = 'source_ingest' and j.status in ('queued', 'running');

  insert into public.rights_takedowns (video_id, reason, sources_count, chunks_deleted, moments_deleted, summaries_deleted, active_jobs)
  values (p_video_id, btrim(p_reason), v_sources, v_chunks, v_moments, v_summaries, v_active);

  return jsonb_build_object(
    'sources', v_sources, 'chunks_deleted', v_chunks, 'moments_deleted', v_moments,
    'summaries_deleted', v_summaries, 'active_jobs', v_active
  );
end;
$$;

comment on function public.takedown_video(text, text) is
  '권리자 삭제 요청 처리(029c). 해당 video_id의 모든 자료 비활성 + 청크·장면·요약 삭제 + rights_takedowns 기록. service_role 전용';

revoke all on function public.takedown_video(text, text) from public, anon, authenticated, service_role;
grant execute on function public.takedown_video(text, text) to service_role;

-- 3) replace_source_moments 재정의 ------------------------------------------------
-- 20261112000100 본문 그대로이고, 비활성(unavailable_at) 자료는 false로 거부하며 자료 행을 잠근다.
-- takedown_video가 먼저 끝나면 진행 중이던 수집이 장면을 되살리지 못하고(false → 롤백),
-- 수집이 먼저 끝나면 takedown_video가 잠금을 기다린 뒤 장면을 지운다.
create or replace function public.replace_source_moments(p_job_id uuid, p_attempt integer, p_moments jsonb) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_source public.sources;
begin
  if p_moments is null or jsonb_typeof(p_moments) <> 'array' or jsonb_array_length(p_moments) > 500 then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_moments) e
     where jsonb_typeof(e) <> 'object'
        -- 캐스트는 숫자일 때만 한다(OR는 평가 순서를 보장하지 않는다)
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
  ) then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  if (select count(distinct (e ->> 'moment_index')::numeric) <> count(*) from jsonb_array_elements(p_moments) e) then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest'
   for update;
  if not found then
    return false;
  end if;

  -- 비활성(권리자 삭제·재확인 비공개) 자료에는 쓰지 않는다. 행 잠금으로 takedown_video의 sources UPDATE와 직렬화한다
  select * into v_source from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for no key update;
  if not found then
    return false;
  end if;
  if v_source.source_type <> 'youtube' then
    raise exception 'not_youtube_source' using errcode = '22023';
  end if;
  -- 영상 길이를 넘는 구간은 거부한다(시각 검증은 Worker가 먼저 하고, 여기는 마지막 방어선)
  if v_source.duration_seconds is not null and exists (
    select 1 from jsonb_array_elements(p_moments) e
     where (e -> 'locator' ->> 't_end')::numeric > v_source.duration_seconds
  ) then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;

  delete from public.source_moments where source_id = v_source.id;
  insert into public.source_moments (source_id, project_id, user_id, moment_index, locator, title, description)
  select v_source.id, v_source.project_id, v_source.user_id, (e ->> 'moment_index')::integer,
         jsonb_build_object('t_start', e -> 'locator' -> 't_start', 't_end', e -> 'locator' -> 't_end'),
         btrim(e ->> 'title'), btrim(e ->> 'description')
    from jsonb_array_elements(p_moments) e;
  return true;
end;
$$;

comment on function public.replace_source_moments(uuid, integer, jsonb) is
  '유튜브 장면 카드를 (job_id, attempt) 펜싱 아래 통째로 교체한다. 비활성 자료는 거부. Worker 전용(task-027a·029c)';

-- 4) register_youtube_source 재정의 ------------------------------------------------
-- 20261112000200 본문 그대로이고, 같은 영상 중복 확인 뒤(한도·쿼터보다 먼저) rights_takedowns에 있는 video_id를 거부한다.
-- 오류 코드(SQLSTATE) 추가: KF451 video_taken_down 권리자 삭제된 영상. 나머지는 20261112000100 주석과 같다.
create or replace function public.register_youtube_source(
  p_user_id uuid,
  p_project_id uuid,
  p_video_id text,
  p_title text,
  p_channel_title text,
  p_duration_seconds integer,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_inserted integer;
  v_existing public.idempotency_keys;
  v_max_sources integer;
  v_max_video integer;
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid_video_id' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 300 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_channel_title is null or char_length(btrim(p_channel_title)) not between 1 and 300 then
    raise exception 'invalid_channel_title' using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 1 then
    raise exception 'invalid_duration' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200
     or p_request_hash is null or char_length(p_request_hash) not between 1 and 128 then
    raise exception 'invalid_idempotency_input' using errcode = '22023';
  end if;

  -- 해당 사용자의 삭제되지 않은 프로젝트만. 행을 잠가 같은 프로젝트의 동시 등록을 직렬화한다
  select id into v_project_id from public.projects
   where id = p_project_id and user_id = p_user_id and deleted_at is null
   for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  -- 멱등 키 선점(claim_idempotency_key와 같은 규칙, 대상 사용자를 인자로)
  insert into public.idempotency_keys (user_id, key, request_hash, resource_type, resource_id)
  values (p_user_id, p_idempotency_key, p_request_hash, 'source', v_source_id)
  on conflict (user_id, key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into v_existing from public.idempotency_keys k where k.user_id = p_user_id and k.key = p_idempotency_key;
    if v_existing.request_hash <> p_request_hash or v_existing.resource_type <> 'source' then
      raise exception 'idempotency_conflict' using errcode = 'KF409';
    end if;
    select s.id, j.id into v_source_id, v_job_id
      from public.sources s
      left join lateral (
        select id from public.processing_jobs where source_id = s.id and job_type = 'source_ingest' order by created_at desc limit 1
      ) j on true
     where s.id = v_existing.resource_id and s.user_id = p_user_id;
    if v_source_id is null then
      raise exception 'idempotency_resource_missing' using errcode = 'KF410';
    end if;
    return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', true);
  end if;

  -- 같은 영상 중복은 한도·쿼터보다 먼저 알린다(프로젝트 잠금으로 직렬화되어 경합 없음)
  if exists (
    select 1 from public.sources
     where project_id = v_project_id and video_id = p_video_id and deleted_at is null
  ) then
    raise exception 'duplicate_video' using errcode = '23505';
  end if;

  -- 권리자 요청으로 삭제(takedown_video)된 영상은 다시 등록할 수 없다
  if exists (select 1 from public.rights_takedowns where video_id = p_video_id) then
    raise exception 'video_taken_down' using errcode = 'KF451';
  end if;

  select p.max_sources_per_project, p.max_video_seconds into v_max_sources, v_max_video
    from public.user_quotas uq join public.plans p on p.code = uq.plan_code
   where uq.user_id = p_user_id;
  if v_max_sources is null then
    raise exception 'quota_not_initialized' using errcode = 'P0002';
  end if;
  if p_duration_seconds > v_max_video then
    raise exception 'video_too_long' using errcode = 'KF413';
  end if;
  if (select count(*) from public.sources where project_id = v_project_id and deleted_at is null) >= v_max_sources then
    raise exception 'source_limit_exceeded' using errcode = 'KF429';
  end if;

  perform public.consume_quota_for(p_user_id, 'source_jobs', 1);
  perform public.consume_quota_for(p_user_id, 'video_seconds', p_duration_seconds);

  insert into public.sources (
    id, project_id, user_id, source_type, title, original_url,
    video_id, channel_title, duration_seconds, metadata_checked_at, video_seconds_charged, video_seconds_charged_period
  ) values (
    v_source_id, v_project_id, p_user_id, 'youtube', btrim(p_title), 'https://www.youtube.com/watch?v=' || p_video_id,
    p_video_id, btrim(p_channel_title), p_duration_seconds, now(), p_duration_seconds, public.current_period_start()
  );

  insert into public.processing_jobs (user_id, source_id, job_type)
  values (p_user_id, v_source_id, 'source_ingest')
  returning id into v_job_id;

  return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', false);
end;
$$;

comment on function public.register_youtube_source(uuid, uuid, text, text, text, integer, text, text) is
  '유튜브 자료 등록. service_role(웹 서버) 전용, 소유·한도·중복·권리자 삭제는 함수 안에서 재확인(task-027a·029c)';
