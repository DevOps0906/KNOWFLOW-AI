-- task-010: A-05 재시도 자격·요청 한도(RPC 안에서 강제)와 작업 목록 조회.
-- 오류 코드(SQLSTATE):
--   retry_source: 기존(28000·P0002·22023·KF409·KF410) + KF422 재시도 불가 실패,
--     KF429는 message로 구분: retry_limit_exceeded(자료당 영구 한도) · quota_exceeded(월 쿼터) · retry_rate_limited(분당 요청 한도).
--     quota_exceeded·retry_rate_limited는 DETAIL에 다시 시도할 수 있을 때까지의 초를 담는다.
--   list_project_jobs: 28000 미인증, P0002 프로젝트 없음(타인 것도 동일), 22023 잘못된 입력

-- 최종 실패가 재시도 가능한 실패였는지. 판단은 error_code 목록이 아니라 이 값으로 한다.
alter table public.processing_jobs add column retryable boolean not null default true;
comment on column public.processing_jobs.retryable is 'fail_job이 저장한 재시도 가능 여부. false면 retry_source가 KF422로 거부';

comment on table public.auth_rate_limits is '인증·재시도 요청 한도 카운터(고정 윈도). 비식별 키만 저장, 하루 지난 행은 기회가 될 때 정리';

-- fail_job: 동작은 그대로이고, 최종 실패 때 retryable을 작업 행에 남긴다(시도 횟수를 다 쓴 일시 오류는 true로 남는다).
-- no_handler는 서버 설정 문제라 즉시 최종 실패로 닫되, 설정을 고친 뒤 재시도할 수 있게 true로 남긴다.
create or replace function public.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_retryable boolean default true) returns text
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
     set status = 'failed', error_code = v_code, finished_at = now(), locked_until = null,
         retryable = coalesce(p_retryable, false) or v_code = 'no_handler'
   where id = v_job.id;
  if v_job.source_id is not null then
    perform public.sync_source_status(v_job.source_id, 'failed', v_code);
    perform public.refund_quota(v_job.user_id, 'source_jobs', 1);
  end if;
  return 'failed';
end;
$$;

-- retry_source(A-05): 재시도 불가 실패 거부와 사용자 분당 10회 한도를 추가한다.
-- 한도 카운터는 이 트랜잭션에 묶여 있어 거부되어 롤백된 요청(404·409·422 등)은 세지 않는다. 즉 새 작업을 만든 요청만 센다.
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

  select j.retryable into v_last_retryable
    from public.processing_jobs j
   where j.source_id = p_source_id
   order by j.created_at desc, j.id desc
   limit 1;
  if v_last_retryable is false then
    raise exception 'source_not_retryable' using errcode = 'KF422';
  end if;

  -- 최초 처리 1회 + 재시도 5회까지
  if (select count(*) from public.processing_jobs where source_id = p_source_id) >= 6 then
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
    perform public.consume_quota('source_jobs', 1);
  exception when sqlstate 'KF429' then
    raise exception 'quota_exceeded' using errcode = 'KF429',
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

-- list_project_jobs(A-05): 프로젝트의 자료·리포트 작업 목록. RLS로 본인 행만 본다(SECURITY INVOKER).
-- 정렬은 (created_at desc, id desc), 커서는 마지막 행의 두 값. 다음 쪽 판단은 호출자가 limit + 1로 한다.
create function public.list_project_jobs(
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
       and (p_status is null or j.status = p_status)
       and (p_cursor_created_at is null or (j.created_at, j.id) < (p_cursor_created_at, p_cursor_id))
     order by j.created_at desc, j.id desc
     limit p_limit;
end;
$$;

revoke all on function public.list_project_jobs(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_project_jobs(uuid, text, timestamptz, uuid, integer) to authenticated;
