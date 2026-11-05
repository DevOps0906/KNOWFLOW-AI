-- task-007: 프로젝트 쓰기 RPC. 소유자는 auth.uid()에서만 얻는다(인자로 user_id를 받지 않는다).
-- 오류 코드(SQLSTATE): 28000 미인증, P0002 대상 없음(타인·삭제된 것도 동일), 22023 잘못된 입력,
--   KF429 프로젝트 수 한도 초과, KF409 처리 중 작업이 있어 삭제 불가

create function public.create_project(p_name text, p_description text default null) returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_max integer;
  v_row public.projects;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_project_name' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 1000 then
    raise exception 'invalid_project_description' using errcode = '22023';
  end if;

  -- 사용자 쿼터 행을 잠가 같은 사용자의 동시 생성을 직렬화한다(한도 초과 방지)
  select p.max_projects into v_max
    from public.user_quotas uq join public.plans p on p.code = uq.plan_code
   where uq.user_id = v_uid
   for update of uq;
  if not found then
    raise exception 'quota_not_initialized' using errcode = 'P0002';
  end if;
  if (select count(*) from public.projects where user_id = v_uid and deleted_at is null) >= v_max then
    raise exception 'project_limit_exceeded' using errcode = 'KF429';
  end if;

  insert into public.projects (user_id, name, description)
  values (v_uid, v_name, v_desc)
  returning * into v_row;
  return v_row;
end;
$$;

-- update_project: p_patch는 {name, description, archived} 중 바꿀 키만 담은 객체. 모르는 키는 거부한다.
create function public.update_project(p_id uuid, p_patch jsonb) returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.projects;
  v_name text;
  v_desc text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name', 'description', 'archived')) then
    raise exception 'invalid_project_patch' using errcode = '22023';
  end if;

  select * into v_row from public.projects
   where id = p_id and user_id = v_uid and deleted_at is null
   for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if p_patch ? 'name' then
    if jsonb_typeof(p_patch -> 'name') <> 'string' then
      raise exception 'invalid_project_name' using errcode = '22023';
    end if;
    v_name := btrim(p_patch ->> 'name');
    if char_length(v_name) not between 1 and 100 then
      raise exception 'invalid_project_name' using errcode = '22023';
    end if;
    v_row.name := v_name;
  end if;
  if p_patch ? 'description' then
    if jsonb_typeof(p_patch -> 'description') not in ('string', 'null') then
      raise exception 'invalid_project_description' using errcode = '22023';
    end if;
    v_desc := nullif(btrim(coalesce(p_patch ->> 'description', '')), '');
    if v_desc is not null and char_length(v_desc) > 1000 then
      raise exception 'invalid_project_description' using errcode = '22023';
    end if;
    v_row.description := v_desc;
  end if;
  if p_patch ? 'archived' then
    if jsonb_typeof(p_patch -> 'archived') <> 'boolean' then
      raise exception 'invalid_project_patch' using errcode = '22023';
    end if;
    v_row.archived_at := case when (p_patch ->> 'archived')::boolean then coalesce(v_row.archived_at, now()) else null end;
  end if;

  update public.projects
     set name = v_row.name, description = v_row.description, archived_at = v_row.archived_at
   where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

-- delete_project: 소프트 삭제(deleted_at). 30일 뒤 영구 삭제는 별도 작업.
-- 처리 중(queued·running) 자료·리포트 작업이 있으면 KF409.
create function public.delete_project(p_id uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform 1 from public.projects
   where id = p_id and user_id = v_uid and deleted_at is null
   for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.processing_jobs j
     where j.status in ('queued', 'running')
       and (
         exists (select 1 from public.sources s where s.id = j.source_id and s.project_id = p_id)
         or exists (select 1 from public.reports r where r.id = j.report_id and r.project_id = p_id)
       )
  ) then
    raise exception 'project_has_active_jobs' using errcode = 'KF409';
  end if;

  update public.projects set deleted_at = now() where id = p_id returning deleted_at into v_deleted_at;
  return v_deleted_at;
end;
$$;

revoke all on function public.create_project(text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_project(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.delete_project(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_project(text, text) to authenticated;
grant execute on function public.update_project(uuid, jsonb) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
