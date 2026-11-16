-- task-004 [5/6] 쿼터 차감·환불, 멱등 키 선점, enqueue_job
-- 오류 코드(SQLSTATE): 28000 미인증, P0002 대상 없음(타인 것도 동일), 22023 잘못된 입력,
--   KF429 한도 초과, KF409 멱등 키 충돌(같은 키 + 다른 요청), KF410 멱등 키가 가리키던 자원 없음

-- consume_quota: 내부 함수(EXECUTE 부여 없음). 자원 생성 RPC가 같은 트랜잭션에서 호출한다.
-- 조건부 UPDATE ... RETURNING 한 문장으로 한도 확인과 증가를 처리한다(동시 요청에도 초과 불가).
create function public.consume_quota(p_kind text, p_n integer default 1) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_period date := public.current_period_start();
  v_used integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_n is null or p_n < 1 or p_n > 1000 then
    raise exception 'invalid_quota_amount' using errcode = '22023';
  end if;

  -- 월 경계 지연 초기화(요청 시 계산). 동시 요청은 행 잠금으로 직렬화되어 재확인 시 한 번만 적용된다
  update public.user_quotas
     set period_start = v_period, used_questions = 0, used_reports = 0, used_source_jobs = 0
   where user_id = v_uid and period_start < v_period;

  if p_kind = 'questions' then
    update public.user_quotas uq set used_questions = uq.used_questions + p_n
      from public.plans p
     where uq.user_id = v_uid and p.code = uq.plan_code
       and uq.used_questions + p_n <= p.monthly_questions
    returning uq.used_questions into v_used;
  elsif p_kind = 'reports' then
    update public.user_quotas uq set used_reports = uq.used_reports + p_n
      from public.plans p
     where uq.user_id = v_uid and p.code = uq.plan_code
       and uq.used_reports + p_n <= p.monthly_reports
    returning uq.used_reports into v_used;
  elsif p_kind = 'source_jobs' then
    update public.user_quotas uq set used_source_jobs = uq.used_source_jobs + p_n
      from public.plans p
     where uq.user_id = v_uid and p.code = uq.plan_code
       and uq.used_source_jobs + p_n <= p.monthly_source_jobs
    returning uq.used_source_jobs into v_used;
  else
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;

  if not found then
    if not exists (select 1 from public.user_quotas where user_id = v_uid) then
      raise exception 'quota_not_initialized' using errcode = 'P0002';
    end if;
    raise exception 'quota_exceeded' using errcode = 'KF429';
  end if;
  return v_used;
end;
$$;

-- refund_quota: service_role(Worker) 전용. 대상 사용자를 인자로 받는다. 음수·0 불가, 0 아래로 내려가지 않음,
-- 이번 달 누적만 되돌린다(지난 달 작업의 환불은 무시).
create function public.refund_quota(p_user_id uuid, p_kind text, p_n integer default 1) returns integer
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
  if p_n is null or p_n < 1 or p_n > 1000 then
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
  else
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;
  return v_used; -- 이번 달 행이 없으면 null(환불할 것 없음)
end;
$$;

-- claim_idempotency_key: 내부 헬퍼. 호출자가 미리 만든 자원 id를 키에 묶는다.
-- 새 키면 is_new = true, 이미 있으면 기존 resource_id 반환, 같은 키 + 다른 요청이면 KF409.
-- 같은 키 동시 요청은 유니크 인덱스에서 대기한 뒤(첫 트랜잭션 커밋 후) 기존 행을 본다.
create function public.claim_idempotency_key(
  p_key text, p_request_hash text, p_resource_type text, p_resource_id uuid
) returns table (is_new boolean, resource_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_inserted integer;
  v_existing public.idempotency_keys;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_key is null or char_length(p_key) not between 1 and 200
     or p_request_hash is null or char_length(p_request_hash) not between 1 and 128
     or p_resource_type is null or p_resource_id is null then
    raise exception 'invalid_idempotency_input' using errcode = '22023';
  end if;

  insert into public.idempotency_keys (user_id, key, request_hash, resource_type, resource_id)
  values (v_uid, p_key, p_request_hash, p_resource_type, p_resource_id)
  on conflict (user_id, key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return query select true, p_resource_id;
    return;
  end if;

  select * into v_existing from public.idempotency_keys k where k.user_id = v_uid and k.key = p_key;
  if v_existing.request_hash <> p_request_hash or v_existing.resource_type <> p_resource_type then
    raise exception 'idempotency_conflict' using errcode = 'KF409';
  end if;
  return query select false, v_existing.resource_id;
end;
$$;

-- enqueue_job: 자료 행 + 작업 행을 한 트랜잭션으로 만든다(큐는 processing_jobs 폴링, ADR-0005).
-- 내부 함수: 기능 RPC(자료 등록)가 호출한다. 프로젝트 행을 잠그고 자료 수 한도를 센 뒤, 멱등 키 → 쿼터 → 생성 순서.
create function public.enqueue_job(
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
        select id from public.processing_jobs where source_id = s.id order by created_at desc limit 1
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

-- EXECUTE: 내부 함수는 누구에게도 부여하지 않는다(DEFINER 함수끼리는 소유자 권한으로 호출). refund_quota만 service_role.
revoke all on function public.consume_quota(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.refund_quota(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_idempotency_key(text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_job(uuid, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.refund_quota(uuid, text, integer) to service_role;
