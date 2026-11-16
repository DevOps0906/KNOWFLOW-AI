-- task-029c: 권리자 삭제 요청 처리(docs/youtube-mvp-review.md#5, task-029 결정 7).
-- 1) rights_takedowns: 운영자 처리 감사 기록. 사용자 접근 없음(RLS만 켜고 정책 없음, 권한 회수).
-- 2) takedown_video(video_id, reason): service_role 전용. 모든 사용자의 해당 video_id 자료를 비활성 처리하고
--    청크·장면·요약을 삭제한다. 자료 행·원본 URL 메타는 비활성 표시(027d와 같은 파기 문구)로 남긴다.

create table public.rights_takedowns (
  id uuid primary key default gen_random_uuid(),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  source_ids uuid[] not null default '{}',
  deleted_chunks integer not null default 0 check (deleted_chunks >= 0),
  deleted_moments integer not null default 0 check (deleted_moments >= 0),
  deleted_summaries integer not null default 0 check (deleted_summaries >= 0),
  created_at timestamptz not null default now()
);
alter table public.rights_takedowns enable row level security;
revoke all on public.rights_takedowns from public, anon, authenticated;
create policy rights_takedowns_deny_all on public.rights_takedowns for all to anon, authenticated using (false) with check (false);
create index rights_takedowns_video_id_idx on public.rights_takedowns (video_id, created_at desc);

comment on table public.rights_takedowns is '권리자 삭제 요청 처리 감사 기록(운영자 RPC만 기록·조회). 사용자 접근 없음';

create function public.takedown_video(p_video_id text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_chunks integer;
  v_moments integer;
  v_summaries integer;
  v_audit uuid;
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid_video_id' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- 삭제된 자료(deleted_at)도 포함: 보존 중인 행이 남지 않게 한다
  select coalesce(array_agg(id), '{}') into v_ids from public.sources where video_id = p_video_id;

  update public.sources
     set unavailable_at = coalesce(unavailable_at, now()),
         title = '확인할 수 없는 영상', channel_title = null, duration_seconds = null,
         metadata_checked_at = now()
   where id = any(v_ids);

  delete from public.source_chunks where source_id = any(v_ids);
  get diagnostics v_chunks = row_count;
  delete from public.source_moments where source_id = any(v_ids);
  get diagnostics v_moments = row_count;
  -- source_summaries는 20261112000400(task-029a)에서 만든다
  delete from public.source_summaries where source_id = any(v_ids);
  get diagnostics v_summaries = row_count;

  insert into public.rights_takedowns (video_id, reason, source_ids, deleted_chunks, deleted_moments, deleted_summaries)
  values (p_video_id, btrim(p_reason), v_ids, v_chunks, v_moments, v_summaries)
  returning id into v_audit;

  return jsonb_build_object('audit_id', v_audit, 'sources', coalesce(array_length(v_ids, 1), 0),
                            'chunks', v_chunks, 'moments', v_moments, 'summaries', v_summaries);
end;
$$;

revoke all on function public.takedown_video(text, text) from public, anon, authenticated, service_role;
grant execute on function public.takedown_video(text, text) to service_role;

comment on function public.takedown_video(text, text) is
  '권리자 삭제 요청 처리(운영자, service_role). 해당 video_id의 모든 사용자 자료를 비활성 처리하고 청크·장면·요약 삭제, 감사 기록';

-- replace_source_moments 재정의: 20261112000100 본문 그대로 + 비활성(unavailable_at) 자료는 false, 자료 행 for update 잠금.
-- takedown 후 진행 중이던 Worker가 장면을 다시 채우는 경합을 막는다(replace_source_chunks는 20261112000400에서 같은 수정).
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

  select * into v_source from public.sources where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for update; -- takedown_video(권리자 삭제)와 직렬화
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
