-- task-027d: 유튜브 메타데이터 재확인·파기(05#8 재확인·비활성, 검토 5장). 기능 플래그가 꺼져 있으면 Worker가 스윕·핸들러를 등록하지 않는다.
-- 1) processing_jobs: job_type에 source_recheck 추가(source_id 필수). 진행 중 작업 1개 제약을 job_type별로 나눈다
--    (재확인 작업이 사용자 재시도를 막지 않게, 같은 자료에 진행 중 재확인 작업은 1개).
-- 2) 큐 함수 5개(claim·complete·fail·reap·retry)의 job_type 분기:
--    재확인 작업은 sources.status·쿼터를 건드리지 않고, claim은 사용자 작업(source_ingest·report_generate)을 먼저 가져간다.
--    retry_source의 자격 검사(진행 중·최근 작업 retryable·작업 수 6개)는 source_ingest 작업만 센다.
-- 3) sweep_source_rechecks(service_role): 파기 기한 지난 메타데이터 파기 + 재확인 작업 생성(배치 상한).
-- 4) apply_source_recheck(service_role, 펜싱): 재확인 결과 반영. Worker는 같은 트랜잭션에서 complete_job까지 부른다.
-- 5) enqueue_job·register_youtube_source 멱등 재요청은 수집 작업 ID만, list_project_jobs는 재확인 작업을 숨긴다.
-- 기간: 재확인은 마지막 확인 후 21일부터(30일 갱신 의무 전, 일일 스윕 기준 여러 번 기회), 파기는 29일부터(30일 초과 전).

-- 1) processing_jobs -------------------------------------------------------------
-- 기존 CHECK(이름은 Postgres 자동 명명)를 재확인 유형을 넣어 다시 만든다
alter table public.processing_jobs drop constraint processing_jobs_job_type_check;
alter table public.processing_jobs add constraint processing_jobs_job_type_check
  check (job_type in ('source_ingest', 'report_generate', 'source_recheck'));
alter table public.processing_jobs drop constraint processing_jobs_check2;
alter table public.processing_jobs add constraint processing_jobs_target_check check (
  (job_type in ('source_ingest', 'source_recheck') and source_id is not null)
  or (job_type = 'report_generate' and report_id is not null)
);

drop index public.processing_jobs_one_active_per_source;
-- 같은 자료에 진행 중 수집 작업은 1개(재확인 작업과는 별개)
create unique index processing_jobs_one_active_per_source on public.processing_jobs (source_id)
  where source_id is not null and job_type = 'source_ingest' and status in ('queued', 'running');
-- 같은 자료에 진행 중 재확인 작업은 1개
create unique index processing_jobs_one_active_recheck_per_source on public.processing_jobs (source_id)
  where source_id is not null and job_type = 'source_recheck' and status in ('queued', 'running');

-- 결과 없음(videos.list items 빈 응답) 연속 횟수. 2회 연속이면 비활성 확정, 정상 응답이면 0(apply_source_recheck)
alter table public.sources add column recheck_missing_count integer not null default 0 check (recheck_missing_count between 0 and 1000);
comment on column public.sources.recheck_missing_count is '재확인 결과 없음 연속 횟수. 2회 연속이면 비활성(027d), 정상 응답이면 0';

-- 스윕 대상 조회(유튜브 자료만)
create index sources_youtube_metadata_checked_idx on public.sources (metadata_checked_at) where video_id is not null;

-- 2) 큐 함수 -----------------------------------------------------------------------
-- reap_expired_jobs: 20261112000100 그대로이고, 재확인 작업은 자료 상태·쿼터를 건드리지 않는다
create or replace function public.reap_expired_jobs() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_count integer := 0;
begin
  for v_job in
    select id, user_id, source_id, job_type from public.processing_jobs
     where status = 'running' and locked_until < now() and attempt_count >= max_attempts
     for update skip locked
  loop
    update public.processing_jobs
       set status = 'failed', error_code = 'lease_expired', finished_at = now(), locked_until = null
     where id = v_job.id;
    if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
      perform public.sync_source_status(v_job.source_id, 'failed', 'lease_expired');
      perform public.refund_quota(v_job.user_id, 'source_jobs', 1);
      perform public.refund_source_video_seconds(v_job.source_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- claim_job: 20261103000400 그대로이고 두 가지만 바꾼다.
-- (1) 재확인 작업은 사용자 작업이 없을 때만 가져간다(정렬 첫 키). (2) 재확인 작업은 자료 상태를 바꾸지 않는다.
create or replace function public.claim_job(p_lease_seconds integer default 120) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_lease' using errcode = '22023';
  end if;

  perform public.reap_expired_jobs();

  select * into v_job from public.processing_jobs
   where status = 'queued' or (status = 'running' and locked_until < now())
   order by (job_type = 'source_recheck'), created_at, id
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;

  update public.processing_jobs
     set status = 'running',
         attempt_count = attempt_count + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(),
         started_at = coalesce(started_at, now()),
         progress = 0,
         current_step = null,
         error_code = null
   where id = v_job.id
  returning * into v_job;

  if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
    perform public.sync_source_status(v_job.source_id, 'processing', null);
  end if;
  return to_jsonb(v_job);
end;
$$;

-- complete_job: 20261103000400 그대로이고, 재확인 작업은 자료 상태를 바꾸지 않는다
create or replace function public.complete_job(p_job_id uuid, p_attempt integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  update public.processing_jobs
     set status = 'succeeded', progress = 100, finished_at = now(), locked_until = null, error_code = null
   where id = p_job_id and status = 'running' and attempt_count = p_attempt
  returning * into v_job;
  if not found then
    return false;
  end if;
  if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
    perform public.sync_source_status(v_job.source_id, 'completed', null);
  end if;
  return true;
end;
$$;

-- fail_job: 20261112000100 그대로이고, 재확인 작업은 자료 상태·쿼터를 건드리지 않는다(재시도·최종 실패 모두)
create or replace function public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_retryable boolean default true) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_code text := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'unknown' end;
  v_ingest boolean;
begin
  select * into v_job from public.processing_jobs
   where id = p_job_id and status = 'running' and attempt_count = p_attempt
   for update;
  if not found then
    return 'stale';
  end if;
  v_ingest := v_job.source_id is not null and v_job.job_type = 'source_ingest';

  if coalesce(p_retryable, false) and v_job.attempt_count < v_job.max_attempts then
    update public.processing_jobs
       set status = 'queued', locked_until = null, error_code = v_code
     where id = v_job.id;
    if v_ingest then
      perform public.sync_source_status(v_job.source_id, 'queued', null);
    end if;
    return 'requeued';
  end if;

  update public.processing_jobs
     set status = 'failed', error_code = v_code, finished_at = now(), locked_until = null,
         retryable = coalesce(p_retryable, false) or v_code = 'no_handler'
   where id = v_job.id;
  if v_ingest then
    perform public.sync_source_status(v_job.source_id, 'failed', v_code);
    perform public.refund_quota(v_job.user_id, 'source_jobs', 1);
    perform public.refund_source_video_seconds(v_job.source_id);
  end if;
  return 'failed';
end;
$$;

-- retry_source: 20261112000100 그대로이고, 자격 검사(진행 중 작업·최근 작업 retryable·작업 수)는 source_ingest 작업만 센다
create or replace function public.retry_source(p_source_id uuid, p_idempotency_key text, p_request_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.sources;
  v_job_id uuid := gen_random_uuid();
  v_claim record;
  v_last_retryable boolean;
  v_window_start timestamptz;
  v_hits integer;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select s.* into v_source
    from public.sources s join public.projects p on p.id = s.project_id
   where s.id = p_source_id and s.user_id = v_uid and s.deleted_at is null and p.deleted_at is null
   for update of s;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  select * into v_claim from public.claim_idempotency_key(p_idempotency_key, p_request_hash, 'job', v_job_id);
  if not v_claim.is_new then
    if not exists (select 1 from public.processing_jobs where id = v_claim.resource_id and user_id = v_uid) then
      raise exception 'idempotency_resource_missing' using errcode = 'KF410';
    end if;
    return jsonb_build_object('job_id', v_claim.resource_id, 'duplicate', true);
  end if;

  if v_source.status = 'completed' then
    raise exception 'source_already_completed' using errcode = '22023';
  end if;
  if v_source.status <> 'failed' or exists (
    select 1 from public.processing_jobs
     where source_id = p_source_id and job_type = 'source_ingest' and status in ('queued', 'running')
  ) then
    raise exception 'source_has_active_job' using errcode = 'KF409';
  end if;

  select j.retryable into v_last_retryable
    from public.processing_jobs j
   where j.source_id = p_source_id and j.job_type = 'source_ingest'
   order by j.created_at desc, j.id desc
   limit 1;
  if v_last_retryable is false then
    raise exception 'source_not_retryable' using errcode = 'KF422';
  end if;
  if v_source.source_type = 'youtube' and coalesce(v_source.video_seconds_charged, 0) = 0
     and v_source.duration_seconds is null then
    raise exception 'source_not_retryable' using errcode = 'KF422';
  end if;

  -- 최초 처리 1회 + 재시도 5회까지(재확인 작업은 세지 않는다)
  if (select count(*) from public.processing_jobs where source_id = p_source_id and job_type = 'source_ingest') >= 6 then
    raise exception 'retry_limit_exceeded' using errcode = 'KF429';
  end if;

  -- 사용자 분당 10회(고정 윈도). 같은 행을 잡으므로 동시 요청도 직렬화된다. consume_auth_rate_limit은 이 scope를 받지 않는다.
  v_window_start := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  insert into public.auth_rate_limits as r (scope, key_hash, window_start, hits)
  values ('source_retry', encode(sha256(convert_to(v_uid::text, 'UTF8')), 'hex'), v_window_start, 1)
  on conflict (scope, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 10 then
    raise exception 'retry_rate_limited' using errcode = 'KF429',
      detail = greatest(1, ceil(extract(epoch from (v_window_start + interval '60 seconds' - now()))))::integer::text;
  end if;

  begin
    v_kind := 'source_jobs';
    perform public.consume_quota('source_jobs', 1);
    if v_source.source_type = 'youtube' and coalesce(v_source.video_seconds_charged, 0) = 0 then
      v_kind := 'video_seconds';
      perform public.consume_quota('video_seconds', v_source.duration_seconds);
      update public.sources
         set video_seconds_charged = v_source.duration_seconds, video_seconds_charged_period = public.current_period_start()
       where id = p_source_id;
    end if;
  exception when sqlstate 'KF429' then
    raise exception 'quota_exceeded' using errcode = 'KF429', hint = v_kind,
      detail = greatest(1, ceil(extract(epoch from (
        (public.current_period_start() + interval '1 month')::timestamp at time zone 'Asia/Seoul' - now()
      ))))::integer::text;
  end;

  insert into public.processing_jobs (id, user_id, source_id, job_type)
  values (v_job_id, v_uid, p_source_id, 'source_ingest');
  perform public.sync_source_status(p_source_id, 'queued', null);
  return jsonb_build_object('job_id', v_job_id, 'duplicate', false);
end;
$$;

-- 3) sweep_source_rechecks ------------------------------------------------------------
-- 일일 스윕(Worker, service_role). 한 트랜잭션에서 두 일을 한다. 결과 {enqueued, purged}.
-- (a) 파기: 마지막 확인이 29일 이상 지났거나(갱신 실패가 이어짐) 비활성인 유튜브 자료의 videos.list 데이터를 지운다.
--     title은 NOT NULL이라 고정 문구로 바꾸고 channel_title·duration_seconds는 null. video_seconds_charged(정산용)는 유지.
--     소프트 삭제된 자료도 대상이다(영구 삭제 전까지 API 데이터를 남기지 않는다).
-- (b) 재확인 작업 생성: 마지막 확인이 21일 이상 지난, 삭제·비활성 아닌 유튜브 자료를 p_limit개까지.
--     같은 자료에 진행 중이거나 20시간 안에 만든 재확인 작업이 있으면 건너뛴다(중복 없음, 실패 시 다음 날 다시).
--     정렬: 3일 안에 실패한 재확인 작업이 없는 자료 먼저 → 마지막 재확인 시도가 오래된(없는) 순 → 확인 시각이 오래된 순
--     (계속 실패하는 자료가 배치를 독점하지 않게). 작업 소유자는 자료 소유자, 사용자 쿼터는 차감하지 않는다.
-- (c) 정리: 끝난 지 7일 지난 failed 재확인 작업 행을 지운다.
-- 결과 {enqueued, purged, cleaned, stale_queued}. stale_queued는 24시간 넘게 queued인 재확인 작업 수(Worker 경고 로그).
-- 오류: 22023 p_limit 범위(1~1000) 밖
create function public.sweep_source_rechecks(p_limit integer default 200) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purged integer;
  v_enqueued integer;
  v_cleaned integer;
  v_stale integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_sweep_limit' using errcode = '22023';
  end if;
  -- 여러 Worker가 동시에 스윕해도 한 번에 하나만 돈다
  perform pg_advisory_xact_lock(hashtext('public.sweep_source_rechecks'));

  update public.sources
     set title = '확인할 수 없는 영상', channel_title = null, duration_seconds = null
   where video_id is not null
     and (channel_title is not null or duration_seconds is not null)
     and (unavailable_at is not null or metadata_checked_at is null or metadata_checked_at <= now() - interval '29 days');
  get diagnostics v_purged = row_count;

  insert into public.processing_jobs (user_id, source_id, job_type)
  select s.user_id, s.id, 'source_recheck'
    from public.sources s join public.projects p on p.id = s.project_id
   where s.video_id is not null
     and s.deleted_at is null and p.deleted_at is null and s.unavailable_at is null
     and (s.metadata_checked_at is null or s.metadata_checked_at <= now() - interval '21 days')
     and not exists (
       select 1 from public.processing_jobs j
        where j.source_id = s.id and j.job_type = 'source_recheck'
          and (j.status in ('queued', 'running') or j.created_at > now() - interval '20 hours')
     )
   order by exists (
              select 1 from public.processing_jobs j
               where j.source_id = s.id and j.job_type = 'source_recheck' and j.status = 'failed'
                 and j.created_at > now() - interval '3 days'
            ),
            (select max(j.created_at) from public.processing_jobs j where j.source_id = s.id and j.job_type = 'source_recheck') nulls first,
            s.metadata_checked_at nulls first, s.id
   limit p_limit
  on conflict (source_id) where source_id is not null and job_type = 'source_recheck' and status in ('queued', 'running')
  do nothing;
  get diagnostics v_enqueued = row_count;

  delete from public.processing_jobs
   where job_type = 'source_recheck' and status = 'failed' and coalesce(finished_at, updated_at) < now() - interval '7 days';
  get diagnostics v_cleaned = row_count;

  select count(*) into v_stale from public.processing_jobs
   where job_type = 'source_recheck' and status = 'queued' and created_at < now() - interval '24 hours';

  return jsonb_build_object('enqueued', v_enqueued, 'purged', v_purged, 'cleaned', v_cleaned, 'stale_queued', v_stale);
end;
$$;

comment on function public.sweep_source_rechecks(integer) is
  '유튜브 메타데이터 일일 스윕(027d): 29일 지난·비활성 메타데이터 파기, 21일 지난 자료의 source_recheck 작업 생성(상한 p_limit)';

-- 4) apply_source_recheck ---------------------------------------------------------------
-- 재확인 결과 반영(펜싱: source_recheck 작업이 이 attempt로 running일 때만, 아니면 false).
-- p_result: {"kind":"available","title":t,"channel_title":c,"duration_seconds":n} → 메타데이터 갱신·metadata_checked_at=now()
--           {"kind":"unavailable"} → unavailable_at 설정(이미 있으면 유지)·즉시 파기·metadata_checked_at=now() (비공개·업로드 삭제/거절)
--           {"kind":"missing"} → 결과 없음 연속 횟수 +1. 2회 연속이면 unavailable과 같이 처리, 아니면 확인 시각을 바꾸지 않는다(다음 스윕이 다시)
-- available은 연속 횟수를 0으로 되돌린다.
-- 자료가 삭제됐거나 이미 비활성이면(available) 바꾸지 않고 true(작업은 끝낸다). sources.status·쿼터·video_seconds_charged는 바꾸지 않는다.
-- 오류(SQLSTATE): 22023 결과 형식 오류(title·channel_title 1~300자, duration_seconds 1 이상 정수)
create function public.apply_source_recheck(p_job_id uuid, p_attempt integer, p_result jsonb) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_kind text := p_result ->> 'kind';
  v_missing integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' or v_kind is null or v_kind not in ('available', 'unavailable', 'missing') then
    raise exception 'invalid_recheck_result' using errcode = '22023';
  end if;
  if v_kind = 'available' and (
    jsonb_typeof(p_result -> 'title') is distinct from 'string'
    or char_length(btrim(p_result ->> 'title')) not between 1 and 300
    or jsonb_typeof(p_result -> 'channel_title') is distinct from 'string'
    or char_length(btrim(p_result ->> 'channel_title')) not between 1 and 300
    -- 캐스트는 숫자일 때만 한다(OR는 평가 순서를 보장하지 않는다)
    or case when jsonb_typeof(p_result -> 'duration_seconds') = 'number'
            then (p_result ->> 'duration_seconds')::numeric <> trunc((p_result ->> 'duration_seconds')::numeric)
              or (p_result ->> 'duration_seconds')::numeric not between 1 and 2147483647
            else true end
  ) then
    raise exception 'invalid_recheck_result' using errcode = '22023';
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_recheck'
   for update;
  if not found then
    return false;
  end if;

  if v_kind = 'available' then
    update public.sources
       set title = btrim(p_result ->> 'title'),
           channel_title = btrim(p_result ->> 'channel_title'),
           duration_seconds = (p_result ->> 'duration_seconds')::integer,
           metadata_checked_at = now(),
           recheck_missing_count = 0
     where id = v_job.source_id and video_id is not null and deleted_at is null and unavailable_at is null;
    return true;
  end if;

  if v_kind = 'missing' then
    update public.sources
       set recheck_missing_count = recheck_missing_count + 1
     where id = v_job.source_id and video_id is not null and deleted_at is null and unavailable_at is null
    returning recheck_missing_count into v_missing;
    if v_missing is null or v_missing < 2 then
      return true;
    end if;
  end if;

  -- unavailable 또는 결과 없음 2회 연속: 비활성 확정·즉시 파기
  update public.sources
     set unavailable_at = coalesce(unavailable_at, now()),
         title = '확인할 수 없는 영상', channel_title = null, duration_seconds = null,
         metadata_checked_at = now()
   where id = v_job.source_id and video_id is not null and deleted_at is null;
  return true;
end;
$$;

comment on function public.apply_source_recheck(uuid, integer, jsonb) is
  '유튜브 재확인 결과 반영(027d, 펜싱). available은 메타데이터 갱신, unavailable은 비활성·즉시 파기, missing은 2회 연속일 때 비활성. 같은 트랜잭션에서 complete_job';

revoke all on function public.sweep_source_rechecks(integer) from public, anon, authenticated, service_role;
revoke all on function public.apply_source_recheck(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sweep_source_rechecks(integer) to service_role;
grant execute on function public.apply_source_recheck(uuid, integer, jsonb) to service_role;

-- 5) 재확인 작업과 섞이지 않게(027d 후속) ----------------------------------------------
-- enqueue_job(20261102000500)·register_youtube_source(20261112000100): 멱등 재요청이 돌려주는 작업을 source_ingest로 한정한다
-- (재확인 작업이 더 최신이어도 수집 작업 ID). 나머지는 원본 그대로.
create or replace function public.enqueue_job(
  p_project_id uuid,
  p_source_type text,
  p_title text,
  p_original_url text,
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
  v_project_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_claim record;
  v_max_sources integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_source_type is null or p_source_type not in ('pdf', 'url') then
    raise exception 'invalid_source_type' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 300 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_content_hash is not null and p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;
  if p_source_type = 'pdf' then
    -- 경로 첫 폴더 = 본인 user_id, 상위 경로 조작 금지
    if p_storage_path is null
       or split_part(p_storage_path, '/', 1) <> v_uid::text
       or position('/' in p_storage_path) = 0
       or p_storage_path ~ '(^|/)\.\.?(/|$)'
       or p_storage_path ~ '//'
       or p_original_url is not null then
      raise exception 'invalid_storage_path' using errcode = '22023';
    end if;
  else
    if p_original_url is null or p_original_url !~* '^https?://' or char_length(p_original_url) > 2048
       or p_storage_path is not null then
      raise exception 'invalid_url' using errcode = '22023';
    end if;
  end if;

  -- 본인의 삭제되지 않은 프로젝트만. 타인 것·없는 것·삭제된 것은 같은 오류
  select id into v_project_id from public.projects
   where id = p_project_id and user_id = v_uid and deleted_at is null
   for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  select * into v_claim from public.claim_idempotency_key(p_idempotency_key, p_request_hash, 'source', v_source_id);
  if not v_claim.is_new then
    select s.id, j.id into v_source_id, v_job_id
      from public.sources s
      left join lateral (
        select id from public.processing_jobs where source_id = s.id and job_type = 'source_ingest' order by created_at desc limit 1
      ) j on true
     where s.id = v_claim.resource_id and s.user_id = v_uid;
    if v_source_id is null then
      raise exception 'idempotency_resource_missing' using errcode = 'KF410';
    end if;
    return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', true);
  end if;

  select p.max_sources_per_project into v_max_sources
    from public.user_quotas uq join public.plans p on p.code = uq.plan_code
   where uq.user_id = v_uid;
  if v_max_sources is null then
    raise exception 'quota_not_initialized' using errcode = 'P0002';
  end if;
  if (select count(*) from public.sources where project_id = v_project_id and deleted_at is null) >= v_max_sources then
    raise exception 'source_limit_exceeded' using errcode = 'KF429';
  end if;

  perform public.consume_quota('source_jobs', 1);

  insert into public.sources (id, project_id, user_id, source_type, title, original_url, storage_path, content_hash)
  values (v_source_id, v_project_id, v_uid, p_source_type, btrim(p_title), p_original_url, p_storage_path, p_content_hash);

  insert into public.processing_jobs (user_id, source_id, job_type)
  values (v_uid, v_source_id, 'source_ingest')
  returning id into v_job_id;

  return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', false);
end;
$$;

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

-- list_project_jobs(20261111000200): source_recheck 작업은 목록에서 뺀다. 나머지는 원본 그대로(SECURITY INVOKER, 권한 유지)
create or replace function public.list_project_jobs(
  p_project_id uuid,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 21
) returns table (
  id uuid,
  job_type text,
  status text,
  current_step text,
  progress integer,
  attempt_count integer,
  error_code text,
  retryable boolean,
  source_id uuid,
  source_status text,
  report_id uuid,
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_limit is null or p_limit not between 1 and 101
     or (p_status is not null and p_status not in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
     or (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'invalid_list_input' using errcode = '22023';
  end if;

  -- 프로젝트가 RLS로 보이지 않으면(타인·삭제됨) 빈 목록이 아니라 404로 분기한다
  perform 1 from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  return query
    select j.id, j.job_type, j.status, j.current_step, j.progress, j.attempt_count, j.error_code, j.retryable,
           j.source_id, s.status, j.report_id, j.created_at, j.started_at, j.finished_at
      from public.processing_jobs j
      left join public.sources s on s.id = j.source_id and s.project_id = p_project_id
      left join public.reports r on r.id = j.report_id and r.project_id = p_project_id
     where (s.id is not null or r.id is not null)
       and j.job_type <> 'source_recheck' -- 재확인(027d)은 시스템 작업이라 사용자에게 보이지 않는다
       and (p_status is null or j.status = p_status)
       and (p_cursor_created_at is null or (j.created_at, j.id) < (p_cursor_created_at, p_cursor_id))
     order by j.created_at desc, j.id desc
     limit p_limit;
end;
$$;
