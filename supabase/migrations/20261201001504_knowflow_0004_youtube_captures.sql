-- KNOWFLOW AI · org안 task-030: L1 사용자 승인 탭 캡처(source_captures · 비공개 버킷 knowflow-captures).
-- 원본: KNOWFLOW-AI task-030 · ADR-0006 결정 1 · docs/youtube-mvp-review.md#4(L1 초기값: 비공개 저장, 영상당 20장, 공개 공유 금지, 권리자 요청·영상 삭제 시 제거).
-- 법무 판정(task-026) 전이므로 웹은 캡처 플래그(기본 꺼짐)로 A-11 전체를 422로 막는다. 이 SQL은 스키마·권한만 먼저 둔다.
-- 1) source_captures: 유튜브 자료의 캡처 1장 = 1행. 읽기 = 조직 멤버, 자료가 보이고(미삭제) unavailable_at is null일 때만. 쓰기는 RPC만.
-- 2) create_source_capture(자료, 장면 카드, 형식, 크기): owner·admin·editor. 자료 행을 잠가 영상당 20장을 직렬화해 센다(21장째 KF429).
--    discard_source_capture(캡처): 업로드 실패 시 웹이 방금 만든 행을 지운다.
-- 3) 제거: 자료 삭제(deleted_at)·비활성(unavailable_at, takedown_video 포함)·프로젝트 삭제 시 트리거가 캡처 행을 지운다.
--    지운 행의 객체 경로는 nomad_knowflow_private.capture_object_trash에 쌓인다. 정리 작업(service_role)은
--    claim_capture_object_trash로 경로를 맡고(claimed_at·attempts, 15분 지난 claim은 다시 배정) Storage에서 지운 뒤
--    ack_capture_object_trash로 대기열에서 뺀다. Storage 삭제가 실패하면 ack하지 않으므로 경로를 잃지 않는다.
--    시도 상한: attempts가 10(capture_trash_max_attempts) 이상인 경로는 더 배정하지 않고 행을 남긴다.
--    운영자는 list_stalled_capture_object_trash(service_role)로 상한에 걸린 경로 수·경로를 확인한다.
--    행이 없는 객체는 select 정책상 아무도 읽지 못한다(정리 전에도 노출 없음).
-- 4) Storage: 비공개 버킷 knowflow-captures(PNG·WebP, 2MB). 경로 = <organization_id>/<project_id>/<source_id>/<capture_id>.<png|webp>.
--    읽기 = 캡처 행이 보이는 사람, 업로드 = 그 행 경로에만 쓰기 역할, 삭제 = 쓰기 역할이 행이 없는(고아) 객체만. UPDATE 정책 없음(덮어쓰기 불가).
-- 전제: 0001_knowflow.sql · 0003(takedown_video가 unavailable_at을 설정 → 트리거로 캡처 제거).
-- 되돌림: drop function nomad_knowflow.create_source_capture(uuid, uuid, text, integer), nomad_knowflow.discard_source_capture(uuid),
--   nomad_knowflow.claim_capture_object_trash(integer), nomad_knowflow.ack_capture_object_trash(text[]),
--   nomad_knowflow.list_stalled_capture_object_trash(integer), nomad_knowflow_private.capture_trash_max_attempts(); drop trigger …(sources·projects·source_captures);
--   drop table nomad_knowflow.source_captures, nomad_knowflow_private.capture_object_trash; drop policy knowflow_captures_objects_*; 버킷 삭제는 객체를 비운 뒤.
begin;

-- ===== 1) source_captures =====
create table nomad_knowflow.source_captures (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  organization_id uuid not null,
  -- 캡처할 때 고른 장면 카드. 재처리로 카드가 바뀌어도 캡처는 남는다(시각은 t_seconds)
  moment_id uuid references nomad_knowflow.source_moments (id) on delete set null,
  -- 캡처한 장면 카드의 시작 시각(초). 화면 표기·원본 링크(&t=)에 쓴다
  t_seconds numeric not null check (t_seconds >= 0),
  mime_type text not null check (mime_type in ('image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  storage_path text not null unique check (char_length(storage_path) <= 1024),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references nomad_knowflow.sources (id, project_id) on delete cascade,
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade
);
comment on table nomad_knowflow.source_captures is
  'L1 사용자 승인 탭 캡처(task-030). 영상당 20장, 비공개. 자료 삭제·비활성·프로젝트 삭제 시 삭제';
alter table nomad_knowflow.source_captures enable row level security;
create index source_captures_source_id_idx on nomad_knowflow.source_captures (source_id, created_at);
create index source_captures_organization_id_idx on nomad_knowflow.source_captures (organization_id);
create index source_captures_project_id_idx on nomad_knowflow.source_captures (project_id);
create index source_captures_moment_id_idx on nomad_knowflow.source_captures (moment_id);

revoke all on nomad_knowflow.source_captures from public, anon, authenticated, service_role;
grant select on nomad_knowflow.source_captures to authenticated, service_role;
-- 조직 멤버만, 자료가 보이고(sources RLS: 미삭제·프로젝트 미삭제) 비활성이 아닐 때만. 쓰기 정책 없음(RPC만)
create policy source_captures_select_org on nomad_knowflow.source_captures for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null
    and exists (select 1 from nomad_knowflow.sources s where s.id = source_captures.source_id and s.unavailable_at is null));

-- 지운 캡처의 객체 경로(정리 대기). 사용자 접근 없음. claim은 표시만 하고 지우지 않는다(ack에서 지운다)
create table nomad_knowflow_private.capture_object_trash (
  storage_path text primary key,
  queued_at timestamptz not null default now(),
  -- 정리 작업이 마지막으로 맡은 시각(null = 아직 안 맡음). 15분이 지나면 다시 배정한다
  claimed_at timestamptz,
  -- 맡긴 횟수(Storage 삭제가 계속 실패하는 경로를 찾는 데 쓴다)
  attempts integer not null default 0 check (attempts >= 0)
);
create index capture_object_trash_queued_at_idx on nomad_knowflow_private.capture_object_trash (queued_at);
alter table nomad_knowflow_private.capture_object_trash enable row level security;
revoke all on nomad_knowflow_private.capture_object_trash from public, anon, authenticated, service_role;
create policy capture_object_trash_deny_all on nomad_knowflow_private.capture_object_trash
  for all to anon, authenticated using (false) with check (false);

-- ===== 2) 쓰기 RPC =====
-- 캡처 행을 만들고 업로드할 경로를 돌려준다. 웹은 이 경로로만 업로드할 수 있다(Storage insert 정책).
-- 순서: 인증 → 형식·크기 → 자료(쓰기 역할·미삭제·프로젝트 미삭제) 잠금 → 유튜브 → 비활성 → knowledge_base 기능 → 장면 카드 → 영상당 20장.
-- 반환: {"capture_id", "storage_path", "t_seconds"}
-- 오류: 28000 not_authenticated · 22023 invalid_capture(형식·크기) / not_youtube_source / moment_without_time · P0002 source_not_found / moment_not_found
--   · KF410 source_unavailable · KF403 feature_locked · KF429 capture_limit(HINT captures)
create function nomad_knowflow.create_source_capture(p_source_id uuid, p_moment_id uuid, p_mime_type text, p_byte_size integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_source nomad_knowflow.sources; v_t numeric; v_id uuid := gen_random_uuid(); v_path text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mime_type is null or p_mime_type not in ('image/png', 'image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 2097152 then
    raise exception 'invalid_capture' using errcode = '22023';
  end if;

  select s.* into v_source from nomad_knowflow.sources s
   where s.id = p_source_id and s.deleted_at is null and nomad_knowflow_private.can_write(s.organization_id)
     and exists (select 1 from nomad_knowflow.projects p where p.id = s.project_id and p.deleted_at is null)
   for update of s;
  if not found then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  if v_source.source_type <> 'youtube' then raise exception 'not_youtube_source' using errcode = '22023'; end if;
  if v_source.unavailable_at is not null then raise exception 'source_unavailable' using errcode = 'KF410'; end if;
  perform nomad_knowflow_private.require_feature(v_source.organization_id, 'knowledge_base');

  select (m.locator ->> 't_start')::numeric into v_t from nomad_knowflow.source_moments m
   where m.id = p_moment_id and m.source_id = v_source.id;
  if not found then raise exception 'moment_not_found' using errcode = 'P0002'; end if;
  -- 시각 없는 장면 카드(locator에 t_start 없음)는 캡처 시각을 정할 수 없다
  if v_t is null then raise exception 'moment_without_time' using errcode = '22023'; end if;

  -- 자료 행 잠금(for update) 아래에서 세므로 동시 요청도 20장을 넘지 않는다
  if (select count(*) from nomad_knowflow.source_captures c where c.source_id = v_source.id) >= 20 then
    raise exception 'capture_limit' using errcode = 'KF429', hint = 'captures';
  end if;

  v_path := v_source.organization_id || '/' || v_source.project_id || '/' || v_source.id || '/' || v_id
            || case p_mime_type when 'image/png' then '.png' else '.webp' end;
  insert into nomad_knowflow.source_captures
    (id, source_id, project_id, organization_id, moment_id, t_seconds, mime_type, byte_size, storage_path, created_by)
  values (v_id, v_source.id, v_source.project_id, v_source.organization_id, p_moment_id, v_t, p_mime_type, p_byte_size, v_path, v_uid);
  return jsonb_build_object('capture_id', v_id, 'storage_path', v_path, 't_seconds', v_t);
end;
$$;
comment on function nomad_knowflow.create_source_capture(uuid, uuid, text, integer) is
  'L1 캡처 행 생성(영상당 20장, 쓰기 역할). 반환 경로로만 업로드 가능(task-030)';

-- 업로드 실패 시 방금 만든 행을 지운다(객체 경로는 트리거가 정리 대기열에 넣는다). 반환: 지웠으면 true
create function nomad_knowflow.discard_source_capture(p_capture_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from nomad_knowflow.source_captures c
   where c.id = p_capture_id and nomad_knowflow_private.can_write(c.organization_id);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
comment on function nomad_knowflow.discard_source_capture(uuid) is '캡처 행 삭제(업로드 실패 정리, 쓰기 역할). task-030';

-- 정리 시도 상한(상수). claim은 attempts가 이 값 이상인 경로를 배정하지 않는다(행은 남겨 운영자가 확인).
-- 10회 = 15분 재배정 기준 약 2.5시간 연속 실패. 값을 바꾸려면 새 번호 파일에서 이 함수만 create or replace 한다
create function nomad_knowflow_private.capture_trash_max_attempts() returns integer
language sql immutable set search_path = ''
as $$ select 10 $$;

-- 정리 대기 경로를 맡는다(지우지 않고 claimed_at·attempts만 표시). 아직 안 맡은 경로와 15분 넘게 ack가 없는 경로를
-- 오래된 순으로 준다(시도 상한에 걸린 경로 제외). 정리 작업이 Storage API로 객체를 지운 뒤 ack_capture_object_trash를 부른다. service_role 전용
create function nomad_knowflow.claim_capture_object_trash(p_limit integer default 100) returns text[]
language plpgsql security definer set search_path = ''
as $$
declare v_paths text[];
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'invalid_limit' using errcode = '22023'; end if;
  with picked as (
    select t.storage_path from nomad_knowflow_private.capture_object_trash t
     where (t.claimed_at is null or t.claimed_at < now() - interval '15 minutes')
       and t.attempts < nomad_knowflow_private.capture_trash_max_attempts()
     order by t.queued_at limit p_limit for update skip locked
  ), marked as (
    update nomad_knowflow_private.capture_object_trash t set claimed_at = now(), attempts = t.attempts + 1
      from picked where t.storage_path = picked.storage_path returning t.storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into v_paths from marked;
  return v_paths;
end;
$$;
comment on function nomad_knowflow.claim_capture_object_trash(integer) is
  '지운 캡처의 Storage 경로를 맡는다(15분 지난 claim 재배정, 시도 상한 이상 제외, 행은 ack까지 남김). service_role 전용(task-030)';

-- Storage에서 지운 경로를 대기열에서 뺀다(맡은 경로만). 반환: 뺀 행 수. service_role 전용
create function nomad_knowflow.ack_capture_object_trash(p_paths text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if p_paths is null or cardinality(p_paths) > 1000 then raise exception 'invalid_paths' using errcode = '22023'; end if;
  delete from nomad_knowflow_private.capture_object_trash t
   where t.storage_path = any (p_paths) and t.claimed_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function nomad_knowflow.ack_capture_object_trash(text[]) is
  'Storage 삭제를 마친 캡처 경로를 정리 대기열에서 뺀다. service_role 전용(task-030)';

-- 운영자 확인용: 시도 상한에 걸려 더 배정되지 않는 경로(오래된 순 p_limit개)와 전체 수(stalled_total). service_role 전용.
-- 원인(권한·경로 오류 등)을 고친 뒤 postgres 세션에서 attempts를 0으로 되돌리면 다시 배정된다
create function nomad_knowflow.list_stalled_capture_object_trash(p_limit integer default 100)
returns table (storage_path text, attempts integer, queued_at timestamptz, claimed_at timestamptz, stalled_total bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'invalid_limit' using errcode = '22023'; end if;
  return query
    select t.storage_path, t.attempts, t.queued_at, t.claimed_at, count(*) over ()
      from nomad_knowflow_private.capture_object_trash t
     where t.attempts >= nomad_knowflow_private.capture_trash_max_attempts()
     order by t.queued_at limit p_limit;
end;
$$;
comment on function nomad_knowflow.list_stalled_capture_object_trash(integer) is
  '시도 상한에 걸린 캡처 정리 경로와 전체 수(운영자 확인용). service_role 전용(task-030)';

-- ===== 3) 제거 트리거 =====
-- 캡처 행이 지워지면(직접·자료/프로젝트 cascade·아래 트리거) 객체 경로를 정리 대기열에 넣는다
create function nomad_knowflow_private.queue_capture_object() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into nomad_knowflow_private.capture_object_trash (storage_path) values (old.storage_path) on conflict do nothing;
  return old;
end;
$$;
create trigger source_captures_queue_object after delete on nomad_knowflow.source_captures
  for each row execute function nomad_knowflow_private.queue_capture_object();

-- 자료 삭제·비활성(권리자 요청 takedown_video, 재확인 비활성 판정 포함) 시 그 자료의 캡처를 지운다
create function nomad_knowflow_private.purge_source_captures() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from nomad_knowflow.source_captures where source_id = new.id;
  return null;
end;
$$;
create trigger sources_purge_captures after update of deleted_at, unavailable_at on nomad_knowflow.sources
  for each row
  when ((old.deleted_at is null and new.deleted_at is not null) or (old.unavailable_at is null and new.unavailable_at is not null))
  execute function nomad_knowflow_private.purge_source_captures();

create function nomad_knowflow_private.purge_project_captures() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from nomad_knowflow.source_captures where project_id = new.id;
  return null;
end;
$$;
create trigger projects_purge_captures after update of deleted_at on nomad_knowflow.projects
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function nomad_knowflow_private.purge_project_captures();

revoke execute on function
  nomad_knowflow.create_source_capture(uuid, uuid, text, integer), nomad_knowflow.discard_source_capture(uuid),
  nomad_knowflow.claim_capture_object_trash(integer), nomad_knowflow.ack_capture_object_trash(text[]),
  nomad_knowflow.list_stalled_capture_object_trash(integer), nomad_knowflow_private.capture_trash_max_attempts(),
  nomad_knowflow_private.queue_capture_object(),
  nomad_knowflow_private.purge_source_captures(), nomad_knowflow_private.purge_project_captures()
from public, anon, authenticated, service_role;
grant execute on function
  nomad_knowflow.create_source_capture(uuid, uuid, text, integer), nomad_knowflow.discard_source_capture(uuid)
to authenticated;
grant execute on function nomad_knowflow.claim_capture_object_trash(integer), nomad_knowflow.ack_capture_object_trash(text[]),
  nomad_knowflow.list_stalled_capture_object_trash(integer)
to service_role;

-- ===== 4) Storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowflow-captures', 'knowflow-captures', false, 2097152, array['image/png', 'image/webp'])
on conflict (id) do nothing;

-- 읽기: 그 경로의 캡처 행이 보일 때만(행 RLS = 조직 멤버·자료 미삭제·비활성 아님). 공개 URL 없음, 서명 URL만
create policy knowflow_captures_objects_select_org on storage.objects for select to authenticated
  using (bucket_id = 'knowflow-captures'
    and exists (select 1 from nomad_knowflow.source_captures c where c.storage_path = name));
-- 업로드: create_source_capture가 만든 행의 경로에만, 그 조직의 쓰기 역할만
create policy knowflow_captures_objects_insert_org on storage.objects for insert to authenticated
  with check (bucket_id = 'knowflow-captures'
    and exists (select 1 from nomad_knowflow.source_captures c
                 where c.storage_path = name and nomad_core.organization_role(c.organization_id) in ('owner', 'admin', 'editor')));
-- 삭제: 행이 지워진(고아) 객체만, 첫 폴더 조직의 쓰기 역할만(자료 삭제 직후 웹이 바로 지운다)
create policy knowflow_captures_objects_delete_org on storage.objects for delete to authenticated
  using (bucket_id = 'knowflow-captures'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then nomad_core.organization_role(((storage.foldername(name))[1])::uuid) in ('owner', 'admin', 'editor') else false end
    and not exists (select 1 from nomad_knowflow.source_captures c where c.storage_path = name));

commit;
