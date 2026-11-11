-- task-027a: 유튜브 자료 스키마·RPC(05#8, 검토 5장). 기능 플래그가 꺼져 있으면 웹이 등록을 막는다(스키마만 먼저 넣는다).
-- 1) sources: source_type에 youtube 추가, 유튜브 컬럼과 유형별 CHECK, (project_id, video_id) 부분 유니크
-- 2) 영상 시간 한도: plans(영상당·월) · user_quotas(월 누적) 컬럼, consume_quota에 video_seconds 자원 종류
-- 3) source_moments: 장면 카드 L0(RLS, 소유자 읽기만, 쓰기는 Worker RPC만)
-- 4) register_youtube_source(service_role 전용) · replace_source_moments(펜싱, service_role 전용)
-- source_recheck job_type과 큐 함수 분기는 027d에서 넣는다(여기서 건드리지 않는다).

-- 1) sources ---------------------------------------------------------------
alter table public.sources
  add column video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  add column channel_title text check (channel_title is null or char_length(btrim(channel_title)) between 1 and 300),
  add column duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  add column metadata_checked_at timestamptz,
  -- 등록 때 차감한 영상 시간(초). 영구 실패 환불 시 0으로 바꿔 재시도 뒤 다시 실패해도 두 번 환불하지 않는다
  add column video_seconds_charged integer check (video_seconds_charged is null or video_seconds_charged >= 0),
  -- 그 영상 시간을 차감한 쿼터 기간(KST 월 시작). 환불은 이 기간이 지금 user_quotas.period_start와 같을 때만
  add column video_seconds_charged_period date,
  add constraint sources_video_seconds_charged_period_check
    check ((video_seconds_charged is null) = (video_seconds_charged_period is null));

-- 기존 유형 CHECK(이름은 Postgres 자동 명명)를 유튜브 분기를 넣어 다시 만든다
alter table public.sources drop constraint sources_source_type_check;
alter table public.sources add constraint sources_source_type_check
  check (source_type in ('pdf', 'url', 'youtube'));
alter table public.sources drop constraint sources_check;
alter table public.sources add constraint sources_type_columns_check check (
  (source_type = 'pdf' and storage_path is not null)
  or (source_type = 'url' and original_url is not null)
  or (
    source_type = 'youtube'
    and video_id is not null
    and original_url is not null -- NULL 비교는 CHECK를 통과시키므로 명시한다
    and original_url ='https://www.youtube.com/watch?v=' || video_id -- 정규 URL만(웹·Gemini 입력 공통)
    and storage_path is null and content_hash is null
  )
);
-- 다른 유형은 유튜브 컬럼을 쓰지 않는다
alter table public.sources add constraint sources_youtube_columns_check check (
  source_type = 'youtube'
  or (video_id is null and channel_title is null and duration_seconds is null and metadata_checked_at is null
      and video_seconds_charged is null)
);

-- 같은 프로젝트에 같은 영상은 하나. 소프트 삭제된 자료는 제외해 다시 등록할 수 있게 한다(위반은 23505)
create unique index sources_project_video_id_key on public.sources (project_id, video_id)
  where video_id is not null and deleted_at is null;

comment on column public.sources.video_id is '유튜브 영상 ID(11자). youtube 유형만(05#8)';
comment on column public.sources.channel_title is 'videos.list 채널명. youtube 유형만, 파기 시 null(027d)';
comment on column public.sources.duration_seconds is 'videos.list 영상 길이(초). youtube 유형만, 파기 시 null(027d)';
comment on column public.sources.metadata_checked_at is '마지막 videos.list 확인 시각. 재확인 스윕 기준(027d)';
comment on column public.sources.video_seconds_charged is '차감한 영상 시간(초). 영구 실패로 정산하면 0(이중 환불 방지), 재시도 때 다시 차감';
comment on column public.sources.video_seconds_charged_period is 'video_seconds_charged를 차감한 쿼터 기간. 다른 달이면 환불하지 않는다';

-- 2) 영상 시간 한도 --------------------------------------------------------------
-- 제안값(검토 5장): 영상당 2시간, 사용자 월 20시간
alter table public.plans
  -- 상한 86400은 consume_quota_for·refund_quota의 video_seconds 1회 차감 상한과 같다(둘을 함께 바꾼다)
  add column max_video_seconds integer not null default 7200 check (max_video_seconds between 1 and 86400),
  add column monthly_video_seconds integer not null default 72000 check (monthly_video_seconds > 0);
alter table public.user_quotas
  add column used_video_seconds integer not null default 0 check (used_video_seconds >= 0);

-- consume_quota_for: 내부 함수(EXECUTE 부여 없음). 대상 사용자를 인자로 받는 차감 본체.
-- 한도 초과는 KF429 quota_exceeded이고 HINT에 자원 종류(source_jobs·video_seconds 등)를 담는다(웹이 구분).
-- service_role 전용 등록 RPC(auth.uid() 없음)와 consume_quota(auth.uid())가 함께 쓴다.
-- 조건부 UPDATE ... RETURNING 한 문장으로 한도 확인과 증가를 처리한다(동시 요청에도 초과 불가).
create function public.consume_quota_for(p_user_id uuid, p_kind text, p_n integer default 1) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := public.current_period_start();
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  -- 영상 시간은 초 단위라 상한이 크다. 86400 = plans.max_video_seconds CHECK 상한(영상 1편 최대 길이)과 맞춘다
  if p_n is null or p_n < 1 or p_n > (case when p_kind = 'video_seconds' then 86400 else 1000 end) then
    raise exception 'invalid_quota_amount' using errcode = '22023';
  end if;

  -- 월 경계 지연 초기화(요청 시 계산). 동시 요청은 행 잠금으로 직렬화되어 재확인 시 한 번만 적용된다
  update public.user_quotas
     set period_start = v_period, used_questions = 0, used_reports = 0, used_source_jobs = 0, used_video_seconds = 0
   where user_id = p_user_id and period_start < v_period;

  if p_kind = 'questions' then
    update public.user_quotas uq set used_questions = uq.used_questions + p_n
      from public.plans p
     where uq.user_id = p_user_id and p.code = uq.plan_code
       and uq.used_questions + p_n <= p.monthly_questions
    returning uq.used_questions into v_used;
  elsif p_kind = 'reports' then
    update public.user_quotas uq set used_reports = uq.used_reports + p_n
      from public.plans p
     where uq.user_id = p_user_id and p.code = uq.plan_code
       and uq.used_reports + p_n <= p.monthly_reports
    returning uq.used_reports into v_used;
  elsif p_kind = 'source_jobs' then
    update public.user_quotas uq set used_source_jobs = uq.used_source_jobs + p_n
      from public.plans p
     where uq.user_id = p_user_id and p.code = uq.plan_code
       and uq.used_source_jobs + p_n <= p.monthly_source_jobs
    returning uq.used_source_jobs into v_used;
  elsif p_kind = 'video_seconds' then
    update public.user_quotas uq set used_video_seconds = uq.used_video_seconds + p_n
      from public.plans p
     where uq.user_id = p_user_id and p.code = uq.plan_code
       and uq.used_video_seconds + p_n <= p.monthly_video_seconds
    returning uq.used_video_seconds into v_used;
  else
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;

  if not found then
    if not exists (select 1 from public.user_quotas where user_id = p_user_id) then
      raise exception 'quota_not_initialized' using errcode = 'P0002';
    end if;
    raise exception 'quota_exceeded' using errcode = 'KF429', hint = p_kind;
  end if;
  return v_used;
end;
$$;

-- consume_quota: 기존 시그니처·동작 유지(로그인 사용자 본인 차감). 본체는 consume_quota_for
create or replace function public.consume_quota(p_kind text, p_n integer default 1) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return public.consume_quota_for(v_uid, p_kind, p_n);
end;
$$;

revoke all on function public.consume_quota_for(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.consume_quota(text, integer) from public, anon, authenticated, service_role;

-- refund_quota: video_seconds 종류 추가(상한 86400, 위와 같음). 나머지 동작(이번 달만, 0 아래 불가)·service_role 권한은 그대로
create or replace function public.refund_quota(p_user_id uuid, p_kind text, p_n integer default 1) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := public.current_period_start();
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  if p_n is null or p_n < 1 or p_n > (case when p_kind = 'video_seconds' then 86400 else 1000 end) then
    raise exception 'invalid_quota_amount' using errcode = '22023';
  end if;

  if p_kind = 'questions' then
    update public.user_quotas set used_questions = greatest(used_questions - p_n, 0)
     where user_id = p_user_id and period_start = v_period returning used_questions into v_used;
  elsif p_kind = 'reports' then
    update public.user_quotas set used_reports = greatest(used_reports - p_n, 0)
     where user_id = p_user_id and period_start = v_period returning used_reports into v_used;
  elsif p_kind = 'source_jobs' then
    update public.user_quotas set used_source_jobs = greatest(used_source_jobs - p_n, 0)
     where user_id = p_user_id and period_start = v_period returning used_source_jobs into v_used;
  elsif p_kind = 'video_seconds' then
    update public.user_quotas set used_video_seconds = greatest(used_video_seconds - p_n, 0)
     where user_id = p_user_id and period_start = v_period returning used_video_seconds into v_used;
  else
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;
  return v_used; -- 이번 달 행이 없으면 null(환불할 것 없음)
end;
$$;

-- refund_source_video_seconds: 내부 함수. 영구 실패한 유튜브 자료의 영상 시간을 한 번만 환불한다.
-- video_seconds_charged > 0인 행만 0으로 바꾸며 정산하므로 같은 차감을 두 번 환불하지 않는다(재시도는 retry_source가 다시 차감).
-- 차감 기간(video_seconds_charged_period)이 지금 user_quotas.period_start와 같을 때만 환불한다.
-- 다르면(지난 달 차감) 환불 없이 charged만 0으로 바꾼다 — 이번 달 사용량에서 지난 달 차감분을 빼지 않기 위해서다.
create function public.refund_source_video_seconds(p_source_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_charged integer;
  v_charged_period date;
begin
  select user_id, video_seconds_charged, video_seconds_charged_period into v_user_id, v_charged, v_charged_period
    from public.sources
   where id = p_source_id and source_type = 'youtube' and video_seconds_charged > 0
   for update;
  if not found then
    return;
  end if;
  update public.sources set video_seconds_charged = 0 where id = p_source_id;
  -- refund_quota는 period_start가 이번 달일 때만 깎으므로, 둘을 합치면 "이번 달에 차감한 것만" 환불된다
  if v_charged_period = (select period_start from public.user_quotas where user_id = v_user_id) then
    perform public.refund_quota(v_user_id, 'video_seconds', v_charged);
  end if;
end;
$$;

revoke all on function public.refund_source_video_seconds(uuid) from public, anon, authenticated, service_role;

-- fail_job·reap_expired_jobs: 동작은 20261111000200·20261103000400 그대로이고, 최종 실패 환불에 영상 시간 환불만 더한다
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
    perform public.refund_source_video_seconds(v_job.source_id);
  end if;
  return 'failed';
end;
$$;

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
      perform public.refund_source_video_seconds(v_job.source_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- retry_source: 동작은 20261111000200 그대로이고 두 가지만 더한다.
-- (1) 유튜브 자료가 영구 실패로 정산되어 video_seconds_charged = 0이면 영상 길이만큼 다시 차감하고 charged·기간을 복구한다.
--     charged > 0이면(아직 정산 전) 다시 차감하지 않는다. 영상 길이가 없으면(파기된 메타데이터) KF422 source_not_retryable.
-- (2) 월 쿼터 초과 KF429 quota_exceeded의 HINT에 자원 종류('source_jobs' | 'video_seconds'). DETAIL(남은 초)은 그대로.
-- PDF·URL 자료는 기존과 같다.
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
  if v_source.source_type = 'youtube' and coalesce(v_source.video_seconds_charged, 0) = 0
     and v_source.duration_seconds is null then
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

-- 3) source_moments -----------------------------------------------------------
create table public.source_moments (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  moment_index integer not null check (moment_index >= 0),
  locator jsonb not null check (
    jsonb_typeof(locator) = 'object'
    and case when jsonb_typeof(locator -> 't_start') = 'number' and jsonb_typeof(locator -> 't_end') = 'number'
             then (locator ->> 't_start')::numeric >= 0 and (locator ->> 't_end')::numeric > (locator ->> 't_start')::numeric
             else false end
  ),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  unique (source_id, moment_index)
);
alter table public.source_moments enable row level security;
create index source_moments_user_id_idx on public.source_moments (user_id);
create index source_moments_project_id_idx on public.source_moments (project_id);

comment on table public.source_moments is
  '유튜브 장면 카드 L0(이미지 없음). 시각 검증 통과 구간만. 청크와는 locator 구간 겹침으로 연결(05#8)';

grant select on public.source_moments to authenticated;
-- 소유자만, 자료가 보이고(sources RLS: 미삭제·프로젝트 미삭제) 비활성(unavailable_at)이 아닐 때만. 쓰기 권한은 없다
create policy source_moments_select_own on public.source_moments for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.sources s where s.id = source_moments.source_id and s.unavailable_at is null)
  );

-- 4) register_youtube_source ---------------------------------------------------
-- 유튜브 자료 등록. service_role(웹 서버) 전용: 웹이 세션 소유자·기능 플래그·videos.list 동기 거절을 마친 뒤 user_id를 넘긴다.
-- 함수 안에서 프로젝트 소유·삭제 여부·자료 수·영상 길이·쿼터·중복을 다시 확인하고 sources(queued)·processing_jobs를 만든다.
-- original_url은 video_id로 정규 URL을 만든다. 쿼터는 source_jobs 1 + video_seconds(영상 길이) 차감.
-- 반환: {"source_id", "job_id", "duplicate"} (duplicate = 같은 멱등 키 재요청)
-- 확인 순서: 입력 → 프로젝트 → 멱등 키 → 중복 영상 → 영상 길이 → 자료 수 → 쿼터(source_jobs → video_seconds)
-- 오류 코드(SQLSTATE): 22023 잘못된 입력, P0002 프로젝트 없음(타인 것·삭제된 것 동일)·쿼터 미초기화,
--   23505 duplicate_video 같은 프로젝트에 같은 영상(한도·쿼터보다 먼저),
--   KF413 video_too_long(plans.max_video_seconds), KF429 source_limit_exceeded(자료 수) ·
--   quota_exceeded(월 쿼터, HINT = 'source_jobs' | 'video_seconds'), KF409 멱등 키 충돌, KF410 멱등 키가 가리키던 자원 없음
create function public.register_youtube_source(
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
        select id from public.processing_jobs where source_id = s.id order by created_at desc limit 1
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

comment on function public.register_youtube_source(uuid, uuid, text, text, text, integer, text, text) is
  '유튜브 자료 등록. service_role(웹 서버) 전용, 소유·한도·중복은 함수 안에서 재확인(task-027a)';

revoke all on function public.register_youtube_source(uuid, uuid, text, text, text, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_youtube_source(uuid, uuid, text, text, text, integer, text, text) to service_role;

-- 5) replace_source_moments ----------------------------------------------------
-- 펜싱된 장면 카드 교체. Worker(service_role) 전용. replace_source_chunks와 같은 펜싱:
-- processing_jobs 행을 (id, attempt_count, status='running', source_ingest)로 FOR UPDATE 잠근 트랜잭션에서 통째로 교체한다.
-- Worker는 같은 트랜잭션에서 replace_source_chunks → replace_source_moments → complete_job 순으로 부른다.
-- 오래된 시도·끝난 작업·삭제된 자료는 false. youtube가 아닌 자료는 22023.
-- 장면 형식: [{"moment_index": 0 이상 정수(배열 내 유일), "locator": {"t_start": s, "t_end": s},
--   "title": 1~200자, "description": 1~2000자}] — 0 ≤ t_start < t_end ≤ duration_seconds(값이 있을 때). 최대 500개.
-- 오류 코드(SQLSTATE): 22023 장면 형식 오류·youtube 아닌 자료(not_youtube_source)
create function public.replace_source_moments(p_job_id uuid, p_attempt integer, p_moments jsonb) returns boolean
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

  select * into v_source from public.sources where id = v_job.source_id and deleted_at is null;
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
  '유튜브 장면 카드를 (job_id, attempt) 펜싱 아래 통째로 교체한다. Worker 전용(task-027a)';

revoke all on function public.replace_source_moments(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.replace_source_moments(uuid, integer, jsonb) to service_role;
