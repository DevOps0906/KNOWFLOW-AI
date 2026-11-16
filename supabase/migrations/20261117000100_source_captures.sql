-- task-030: 사용자 승인 탭 캡처 L1(구현 결정 1~5). 기능 스위치 CAPTURE_ENABLED(웹, 기본 꺼짐)와 별개로 스키마만 먼저 넣는다.
-- 법무 판정이 "불가"면 drop 마이그레이션으로 되돌린다(task-030 사용자 결정 ①).
-- 1) source_captures: 캡처 행(RLS 소유자 SELECT만, 쓰기는 service_role RPC만)
-- 2) capture_purge_queue: Storage 객체 삭제 대기열(웹 서버 purgeCaptures가 처리)
-- 3) Storage 버킷 captures: 비공개, WebP·JPEG, 2MB. authenticated 정책 없음(업로드·서명·삭제는 서버 service_role만)
-- 4) reserve_capture · confirm_capture · discard_capture · enqueue_capture_purge(service_role 전용)
-- 5) sources 트리거: 소프트 삭제·비활성·행 삭제 시 그 자료의 캡처를 대기열로 옮기고 행을 지운다
--    (delete_sources·takedown_video·apply_source_recheck를 재정의하지 않고 모두 덮는다. 복구해도 돌아오지 않는다)
-- 6) projects 트리거: 프로젝트 소프트 삭제(delete_project) 시 그 프로젝트 모든 자료의 캡처를 대기열로 옮긴다
-- 오류 코드(SQLSTATE): 22023 잘못된 입력 · P0002 자료 없음(타인·삭제·비활성 포함) · KF422 유튜브 외 자료
--   · KF409 같은 멱등 키를 다른 형식으로 재사용 · KF429 자료당 캡처 한도(20장)

-- 1) source_captures -------------------------------------------------------------
create table public.source_captures (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  -- 자료 소유자(reserve_capture가 sources.user_id와 같은지 확인한다). auth.users FK는 두지 않는다:
  -- 사용자 삭제 cascade에서 캡처 행이 sources 트리거보다 먼저 지워지면 Storage 경로를 잃는다
  user_id uuid not null,
  -- 장면 재처리(replace_source_moments)로 카드가 바뀌어도 캡처는 남는다
  moment_id uuid references public.source_moments (id) on delete set null,
  t_seconds numeric(9, 3) not null check (t_seconds between 0 and 86400),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  bytes integer check (bytes is null or bytes between 1 and 2097152),
  created_at timestamptz not null default now(),
  unique (source_id, idempotency_key),
  check (status = 'pending' or bytes is not null)
);
alter table public.source_captures enable row level security;
create index source_captures_user_id_idx on public.source_captures (user_id);
create index source_captures_moment_id_idx on public.source_captures (moment_id);

comment on table public.source_captures is
  '유튜브 장면 사용자 승인 탭 캡처 L1(task-030). 자료당 20장, 쓰기는 service_role RPC만, 자료 삭제·비활성 시 대기열로 옮겨 지운다';

revoke all on public.source_captures from public, anon, authenticated, service_role;
grant select on public.source_captures to authenticated;
-- 소유자만, 자료가 보이고(sources RLS: 미삭제·프로젝트 미삭제) 비활성이 아닐 때만. 쓰기 정책은 없다
create policy source_captures_select_own on public.source_captures for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.sources s where s.id = source_captures.source_id and s.unavailable_at is null)
  );

-- 2) capture_purge_queue -------------------------------------------------------------
create table public.capture_purge_queue (
  storage_path text primary key check (char_length(storage_path) between 1 and 1024),
  reason text not null check (reason in ('source_deleted', 'project_deleted', 'source_unavailable', 'user_deleted', 'upload_failed', 'pending_expired')),
  queued_at timestamptz not null default now()
);
alter table public.capture_purge_queue enable row level security;

comment on table public.capture_purge_queue is
  '캡처 Storage 객체 삭제 대기열(task-030). 웹 서버 purgeCaptures(service_role)가 객체를 지운 뒤 행을 지운다';

create policy capture_purge_queue_deny_all on public.capture_purge_queue for all to anon, authenticated
  using (false) with check (false);
revoke all on public.capture_purge_queue from public, anon, authenticated, service_role;
grant select, delete on public.capture_purge_queue to service_role;

-- 3) Storage 버킷 captures ------------------------------------------------------------
-- 정책 없음: authenticated는 읽기·쓰기 모두 불가. 서버가 service_role로 업로드·서명 URL·삭제를 한다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 2097152, array['image/webp', 'image/jpeg']) -- 2MB(task-030 결정 3)
on conflict (id) do nothing;

-- 4) RPC ------------------------------------------------------------------------------
-- reserve_capture: 프로젝트 행(for share) → 자료 행(for update) 순서로 잠가 삭제 트리거와 직렬화하고
-- 한도 확인과 삽입을 직렬화한다(프로젝트 소프트 삭제가 진행 중이면 기다린 뒤 P0002). user_id는 서버가 세션에서 꺼낸 값.
-- 10분 지난 pending(업로드 중단) 행은 한도 계산 전에 대기열로 옮기고 지운다.
-- 같은 (자료, 멱등 키)면 기존 행을 돌려준다(duplicate=true, 서버는 다시 올리지 않는다).
-- 경로는 여기서 정한다: {user_id}/{source_id}/{capture_id}.{ext}
-- 반환: {"capture_id", "storage_path", "status", "duplicate"}
create function public.reserve_capture(
  p_source_id uuid,
  p_user_id uuid,
  p_t_seconds numeric,
  p_moment_id uuid,
  p_idempotency_key text,
  p_mime text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.sources;
  v_existing public.source_captures;
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if p_source_id is null or p_user_id is null
     or p_t_seconds is null or p_t_seconds not between 0 and 86400
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_.:-]{1,200}$' then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;
  v_ext := case p_mime when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg' end;
  if v_ext is null then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;

  -- 잠금 순서 projects → sources(프로젝트 삭제 트리거와 같은 순서). for share는 다른 자료의 예약끼리는 막지 않는다
  perform 1 from public.projects p
   where p.id = (select s.project_id from public.sources s where s.id = p_source_id)
     and p.user_id = p_user_id and p.deleted_at is null
   for share;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  select s.* into v_source
    from public.sources s
   where s.id = p_source_id and s.user_id = p_user_id and s.deleted_at is null and s.unavailable_at is null
   for update;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  if v_source.source_type <> 'youtube' then
    raise exception 'not_youtube_source' using errcode = 'KF422';
  end if;

  -- 만료된 pending(업로드가 끝나지 않은 채 10분 지남): 객체가 있을 수 있으므로 경로를 대기열에 넣는다
  with gone as (
    delete from public.source_captures
     where source_id = p_source_id and status = 'pending' and created_at < now() - interval '10 minutes'
    returning storage_path
  )
  insert into public.capture_purge_queue (storage_path, reason)
  select storage_path, 'pending_expired' from gone
  on conflict (storage_path) do nothing;

  select * into v_existing from public.source_captures
   where source_id = p_source_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.storage_path not like '%.' || v_ext then
      raise exception 'idempotency_key_conflict' using errcode = 'KF409';
    end if;
    return jsonb_build_object('capture_id', v_existing.id, 'storage_path', v_existing.storage_path,
                              'status', v_existing.status, 'duplicate', true);
  end if;

  if p_moment_id is not null
     and not exists (select 1 from public.source_moments where id = p_moment_id and source_id = p_source_id) then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;

  if (select count(*) from public.source_captures where source_id = p_source_id) >= 20 then
    raise exception 'capture_limit' using errcode = 'KF429';
  end if;

  v_path := p_user_id::text || '/' || p_source_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.source_captures (id, source_id, user_id, moment_id, t_seconds, storage_path, idempotency_key)
  values (v_id, p_source_id, p_user_id, p_moment_id, p_t_seconds, v_path, p_idempotency_key);
  return jsonb_build_object('capture_id', v_id, 'storage_path', v_path, 'status', 'pending', 'duplicate', false);
end;
$$;

comment on function public.reserve_capture(uuid, uuid, numeric, uuid, text, text) is
  '캡처 자리를 잡는다(자료 잠금·소유·유튜브·자료당 20장·멱등 키). 웹 서버 service_role 전용(task-030)';

-- confirm_capture: 업로드 성공 뒤 pending → ready. 자료·프로젝트가 그새 삭제·비활성이 됐으면(트리거가 행을 지움) false.
-- false면 서버가 방금 올린 객체를 직접 지운다.
create function public.confirm_capture(p_capture_id uuid, p_user_id uuid, p_bytes integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
begin
  if p_capture_id is null or p_user_id is null or p_bytes is null or p_bytes not between 1 and 2097152 then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;
  select source_id into v_source_id from public.source_captures where id = p_capture_id and user_id = p_user_id;
  if not found then
    return false;
  end if;
  -- 트리거(프로젝트 삭제 · 자료 삭제·비활성)와 직렬화. 잠금 순서 projects → sources
  perform 1 from public.projects p
   where p.id = (select s.project_id from public.sources s where s.id = v_source_id) and p.deleted_at is null
   for share;
  if not found then
    return false;
  end if;
  perform 1 from public.sources
   where id = v_source_id and deleted_at is null and unavailable_at is null
   for update;
  if not found then
    return false;
  end if;
  update public.source_captures set status = 'ready', bytes = coalesce(bytes, p_bytes)
   where id = p_capture_id and user_id = p_user_id;
  return found;
end;
$$;

comment on function public.confirm_capture(uuid, uuid, integer) is
  '업로드가 끝난 캡처를 ready로 바꾼다. 자료가 삭제·비활성이면 false. 웹 서버 service_role 전용(task-030)';

-- discard_capture: 사용자 삭제(user_deleted)·업로드 실패(upload_failed). 행을 지우고 경로를 대기열에 넣는다.
-- upload_failed는 pending 행만 지운다(같은 멱등 키의 다른 요청이 확정한 ready 행을 실패 보상이 지우지 않게).
create function public.discard_capture(p_capture_id uuid, p_user_id uuid, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if p_capture_id is null or p_user_id is null or p_reason is null or p_reason not in ('user_deleted', 'upload_failed') then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;
  delete from public.source_captures
   where id = p_capture_id and user_id = p_user_id and (p_reason = 'user_deleted' or status = 'pending')
  returning storage_path into v_path;
  if v_path is null then
    return false;
  end if;
  insert into public.capture_purge_queue (storage_path, reason) values (v_path, p_reason)
  on conflict (storage_path) do nothing;
  return true;
end;
$$;

comment on function public.discard_capture(uuid, uuid, text) is
  '본인 캡처 행을 지우고 Storage 경로를 삭제 대기열에 넣는다. 웹 서버 service_role 전용(task-030)';

-- enqueue_capture_purge: 서버가 객체를 직접 지우다 실패했을 때 경로를 대기열에 다시 넣는다(행은 이미 없음).
-- 경로 형식은 source_captures.storage_path와 같다.
create function public.enqueue_capture_purge(p_storage_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_storage_path is null
     or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$' then
    raise exception 'invalid_capture_input' using errcode = '22023';
  end if;
  insert into public.capture_purge_queue (storage_path, reason) values (p_storage_path, 'upload_failed')
  on conflict (storage_path) do nothing;
end;
$$;

comment on function public.enqueue_capture_purge(text) is
  '객체 직접 삭제가 실패한 캡처 경로를 삭제 대기열에 넣는다. 웹 서버 service_role 전용(task-030)';

revoke all on function public.reserve_capture(uuid, uuid, numeric, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.confirm_capture(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.discard_capture(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_capture(uuid, uuid, numeric, uuid, text, text) to service_role;
grant execute on function public.confirm_capture(uuid, uuid, integer) to service_role;
grant execute on function public.discard_capture(uuid, uuid, text) to service_role;
revoke all on function public.enqueue_capture_purge(text) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_capture_purge(text) to service_role;

-- 5) sources 트리거 ----------------------------------------------------------------------
-- deleted_at 또는 unavailable_at이 null → 값(AFTER UPDATE), 행 삭제(BEFORE DELETE, cascade 포함)
create function public.queue_source_capture_purge() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_source_id := old.id;
    v_reason := 'source_deleted';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_source_id := new.id;
    v_reason := 'source_deleted';
  else
    v_source_id := new.id;
    v_reason := 'source_unavailable';
  end if;

  with gone as (
    delete from public.source_captures where source_id = v_source_id returning storage_path
  )
  insert into public.capture_purge_queue (storage_path, reason)
  select storage_path, v_reason from gone
  on conflict (storage_path) do nothing;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.queue_source_capture_purge() is
  '자료 삭제·비활성 시 그 자료의 캡처를 capture_purge_queue로 옮기고 행을 지운다(트리거 전용, task-030)';

revoke all on function public.queue_source_capture_purge() from public, anon, authenticated, service_role;

create trigger sources_capture_purge_after_update
  after update of deleted_at, unavailable_at on public.sources
  for each row
  when ((old.deleted_at is null and new.deleted_at is not null)
        or (old.unavailable_at is null and new.unavailable_at is not null))
  execute function public.queue_source_capture_purge();

create trigger sources_capture_purge_before_delete
  before delete on public.sources
  for each row
  execute function public.queue_source_capture_purge();

-- 6) projects 트리거 ---------------------------------------------------------------------
-- 프로젝트 소프트 삭제(delete_project: deleted_at null → 값)는 자료의 deleted_at을 바꾸지 않으므로
-- 그 프로젝트 모든 자료의 캡처를 여기서 대기열로 옮긴다(사용자 결정 ②, 복구해도 돌아오지 않음).
create function public.queue_project_capture_purge() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with gone as (
    delete from public.source_captures c
     using public.sources s
     where s.id = c.source_id and s.project_id = new.id
    returning c.storage_path
  )
  insert into public.capture_purge_queue (storage_path, reason)
  select storage_path, 'project_deleted' from gone
  on conflict (storage_path) do nothing;
  return new;
end;
$$;

comment on function public.queue_project_capture_purge() is
  '프로젝트 소프트 삭제 시 그 프로젝트 자료의 캡처를 capture_purge_queue로 옮기고 행을 지운다(트리거 전용, task-030)';

revoke all on function public.queue_project_capture_purge() from public, anon, authenticated, service_role;

create trigger projects_capture_purge_after_update
  after update of deleted_at on public.projects
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.queue_project_capture_purge();
