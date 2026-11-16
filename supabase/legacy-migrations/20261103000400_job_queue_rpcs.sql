-- task-010: 작업 큐 RPC(테이블 폴링, ADR-0005). Worker(service_role)용 함수와 사용자용 재시도 함수.
-- 규칙: 모든 상태 전이는 (job_id, attempt) 펜싱으로 막는다. 임대가 만료돼 다른 Worker가 같은 작업을 다시 가져가면
--   attempt_count가 올라가므로, 이전 Worker의 complete·fail·heartbeat는 'stale'로 거부되어 결과가 중복되지 않는다.
-- 상태 매핑(05#6): queued→queued, running→processing, succeeded→completed, failed·cancelled→failed
-- 오류 코드(SQLSTATE, retry_source): 28000 미인증, P0002 대상 없음(타인 것도 동일), 22023 completed 자료,
--   KF409 진행 중 작업 있음·멱등 키 충돌, KF429 재시도·월 처리 한도 초과, KF410 멱등 키가 가리키던 자원 없음

-- 내부: 자료 상태 동기화(source_ingest 작업만)
create function public.sync_source_status(p_source_id uuid, p_status text, p_error_code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sources
     set status = p_status,
         error_code = case when p_status = 'failed' then p_error_code else null end,
         error_message_safe = case when p_status = 'failed' then '처리하지 못했습니다. 다시 시도해 주세요.' else null end
   where id = p_source_id;
$$;

-- 내부: 시도 횟수를 다 쓴 채 임대가 만료된 running 작업을 실패로 닫는다(좀비 작업이 큐를 막지 않게)
create function public.reap_expired_jobs() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_count integer := 0;
begin
  for v_job in
    select id, user_id, source_id from public.processing_jobs
     where status = 'running' and locked_until < now() and attempt_count >= max_attempts
     for update skip locked
  loop
    update public.processing_jobs
       set status = 'failed', error_code = 'lease_expired', finished_at = now(), locked_until = null
     where id = v_job.id;
    if v_job.source_id is not null then
      perform public.sync_source_status(v_job.source_id, 'failed', 'lease_expired');
      perform public.refund_quota(v_job.user_id, 'source_jobs', 1);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- claim_job: queued 작업 또는 임대가 만료된 running 작업 하나를 가져온다(SKIP LOCKED). 없으면 null.
create function public.claim_job(p_lease_seconds integer default 120) returns jsonb
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
   order by created_at, id
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

  if v_job.source_id is not null then
    perform public.sync_source_status(v_job.source_id, 'processing', null);
  end if;
  return to_jsonb(v_job);
end;
$$;

create function public.heartbeat_job(p_job_id uuid, p_attempt integer, p_lease_seconds integer default 120) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'invalid_lease' using errcode = '22023';
  end if;
  update public.processing_jobs
     set heartbeat_at = now(), locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$$;

create function public.progress_job(p_job_id uuid, p_attempt integer, p_step text, p_progress integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_progress is null or p_progress not between 0 and 99 or p_step is null or char_length(p_step) > 64 then
    raise exception 'invalid_progress' using errcode = '22023';
  end if;
  update public.processing_jobs
     set current_step = p_step, progress = p_progress
   where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$$;

-- complete_job: 현재 시도(attempt)의 소유자만 성공 처리한다. 아니면 false(= 이 Worker는 결과를 버려야 한다).
create function public.complete_job(p_job_id uuid, p_attempt integer) returns boolean
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
  if v_job.source_id is not null then
    perform public.sync_source_status(v_job.source_id, 'completed', null);
  end if;
  return true;
end;
$$;

-- fail_job: 'requeued'(재시도 남음) · 'failed'(최종 실패, 쿼터 환불) · 'stale'(이미 다른 시도가 가져감)
create function public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_retryable boolean default true) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_code text := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'unknown' end;
begin
  select * into v_job from public.processing_jobs
   where id = p_job_id and status = 'running' and attempt_count = p_attempt
   for update;
  if not found then
    return 'stale';
  end if;

  if coalesce(p_retryable, false) and v_job.attempt_count < v_job.max_attempts then
    update public.processing_jobs
       set status = 'queued', locked_until = null, error_code = v_code
     where id = v_job.id;
    if v_job.source_id is not null then
      perform public.sync_source_status(v_job.source_id, 'queued', null);
    end if;
    return 'requeued';
  end if;

  update public.processing_jobs
     set status = 'failed', error_code = v_code, finished_at = now(), locked_until = null
   where id = v_job.id;
  if v_job.source_id is not null then
    perform public.sync_source_status(v_job.source_id, 'failed', v_code);
    perform public.refund_quota(v_job.user_id, 'source_jobs', 1);
  end if;
  return 'failed';
end;
$$;

-- retry_source(A-05): 실패한 자료를 새 작업으로 다시 처리한다. 재시도 = 새 작업(새 멱등 키).
create function public.retry_source(p_source_id uuid, p_idempotency_key text, p_request_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.sources;
  v_job_id uuid := gen_random_uuid();
  v_claim record;
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
    select 1 from public.processing_jobs where source_id = p_source_id and status in ('queued', 'running')
  ) then
    raise exception 'source_has_active_job' using errcode = 'KF409';
  end if;
  -- 최초 처리 1회 + 재시도 5회까지
  if (select count(*) from public.processing_jobs where source_id = p_source_id) >= 6 then
    raise exception 'retry_limit_exceeded' using errcode = 'KF429';
  end if;

  perform public.consume_quota('source_jobs', 1);

  insert into public.processing_jobs (id, user_id, source_id, job_type)
  values (v_job_id, v_uid, p_source_id, 'source_ingest');
  perform public.sync_source_status(p_source_id, 'queued', null);
  return jsonb_build_object('job_id', v_job_id, 'duplicate', false);
end;
$$;

-- EXECUTE: 내부 함수는 아무에게도 주지 않고, Worker 함수는 service_role만, 재시도는 authenticated만
revoke all on function public.sync_source_status(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.reap_expired_jobs() from public, anon, authenticated, service_role;
revoke all on function public.claim_job(integer) from public, anon, authenticated, service_role;
revoke all on function public.heartbeat_job(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.progress_job(uuid, integer, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_job(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.fail_job(uuid, integer, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.retry_source(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_job(integer) to service_role;
grant execute on function public.heartbeat_job(uuid, integer, integer) to service_role;
grant execute on function public.progress_job(uuid, integer, text, integer) to service_role;
grant execute on function public.complete_job(uuid, integer) to service_role;
grant execute on function public.fail_job(uuid, integer, text, boolean) to service_role;
grant execute on function public.retry_source(uuid, text, text) to authenticated;
