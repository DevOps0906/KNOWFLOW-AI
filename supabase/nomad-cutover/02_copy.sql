-- KNOWFLOW nomad DB 전환 2단계: 옛 public 데이터 → nomad_core·nomad_knowflow(org안) 복사. 한 트랜잭션, 기본 dry-run(rollback).
-- 실행(postgres 세션, 01_freeze 뒤·새 migrations push 뒤):
--   dry-run: psql "<DB 주소>" -v ON_ERROR_STOP=1 -v plan_map=beta:B -f supabase/nomad-cutover/02_copy.sql
--   적용   : 위 명령에 -v apply=true 추가
-- plan_map: 옛 plan_code → 제품 플랜(A/B/C) 대응. 쉼표로 여러 개(예: beta:B,pro:A). 대응 없는 옛 값이 하나라도 있으면 중단.
-- 소유: 옛 user_id → 그 사용자의 개인 조직(kind personal, created_by = 사용자, owner 멤버십 1개). 없거나 여럿이면 중단.
-- 시작 검사(어긋나면 raise, 아무것도 안 바뀜): 동결 기록 · 코어 시드 · 익명 소유 행 0 · 플랜 대응 · 개인 조직 · 대상 비어 있음(재실행 방지) · PDF 경로 형식
-- 복사: session_replication_role = replica로 대상 트리거(touch·기능 잠금·캡처 정리)와 FK 트리거를 끄고 id·created_at·updated_at 원본 유지.
--   profiles는 백필이 만든 행을 원본 값으로 덮는다(display_name은 원본이 null이면 백필 값 유지). 구독은 개인 조직마다 1행(active).
--   sources.storage_path는 새 경로(첫 폴더 user_id → organization_id)로 쓴다 → 앱 전환 전에 03_storage 복사·대조가 끝나야 한다.
--   새 컬럼: conversations·reports.deleted_at = null, messages.reply_to·quota_* = null, reports.quota_charged_period = null(이관 행은 환불 대상 아님).
-- 끝 검사: 표마다 행 수 + 핵심 값(id·소유자·시각·경로) 양방향 차집합 0, FK 고아·복합 소유 불일치 0. 시퀀스 없음(uuid PK).
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
\if :{?plan_map}
\else
  \set plan_map ''
\endif

begin;
set local nomad_cutover.plan_map = :'plan_map';

set local session_replication_role = replica;
do $$
begin
  if current_setting('session_replication_role') <> 'replica' then
    raise exception 'replica_not_set: session_replication_role을 replica로 바꾸지 못했다' using errcode = '55000';
  end if;
end $$;

-- ===== 시작 검사 =====
do $$
begin
  if to_regclass('nomad_cutover.frozen_privileges') is null then
    raise exception 'not_frozen: 01_freeze.sql을 먼저 실행한다' using errcode = '55000';
  end if;
  if to_regclass('nomad_knowflow.projects') is null or to_regclass('nomad_core.subscriptions') is null then
    raise exception 'target_schema_missing: 새 migrations(db push)를 먼저 적용한다' using errcode = '55000';
  end if;
  if not exists (select 1 from nomad_core.products where code = 'knowflow') then
    raise exception 'core_seed_missing: nomad_core.products knowflow·plans A/B/C 시드가 필요하다' using errcode = '55000';
  end if;
end $$;

-- 익명 사용자 소유 행(사용자 결정 2: 건수만 보고하고 중단)
do $$
declare v jsonb;
begin
  with anon as (select id from auth.users where is_anonymous),
  c(t, n) as (
    select 'profiles', count(*) from public.profiles where id in (select id from anon) union all
    select 'user_quotas', count(*) from public.user_quotas where user_id in (select id from anon) union all
    select 'projects', count(*) from public.projects where user_id in (select id from anon) union all
    select 'sources', count(*) from public.sources where user_id in (select id from anon) union all
    select 'source_moments', count(*) from public.source_moments where user_id in (select id from anon) union all
    select 'conversations', count(*) from public.conversations where user_id in (select id from anon) union all
    select 'reports', count(*) from public.reports where user_id in (select id from anon) union all
    select 'processing_jobs', count(*) from public.processing_jobs where user_id in (select id from anon) union all
    select 'usage_events', count(*) from public.usage_events where user_id in (select id from anon) union all
    select 'idempotency_keys', count(*) from public.idempotency_keys where user_id in (select id from anon))
  select jsonb_object_agg(t, n) filter (where n > 0) into v from c;
  if v is not null then
    raise exception 'anonymous_owned_rows: 익명 사용자 소유 행이 있다 — 이관 중단' using errcode = 'P0001', detail = v::text;
  end if;
end $$;

-- 플랜 대응(사용자 결정 1)
create temp table cutover_plan_map on commit drop as
select split_part(x, ':', 1) as legacy_code, split_part(x, ':', 2) as plan_code
  from unnest(string_to_array(nullif(current_setting('nomad_cutover.plan_map'), ''), ',')) x;
do $$
declare v text;
begin
  if not exists (select 1 from cutover_plan_map) then
    raise exception 'plan_map_required: -v plan_map=beta:<A|B|C> 가 필요하다' using errcode = '22023';
  end if;
  if exists (select 1 from cutover_plan_map where legacy_code !~ '^[a-z][a-z0-9_]{0,31}$' or plan_code !~ '^[ABC]$')
     or (select count(*) from cutover_plan_map) <> (select count(distinct legacy_code) from cutover_plan_map) then
    raise exception 'plan_map_invalid: 형식은 옛코드:A|B|C, 쉼표 구분, 옛코드 중복 없음' using errcode = '22023';
  end if;
  select string_agg(distinct uq.plan_code, ',') into v
    from public.user_quotas uq where uq.plan_code not in (select legacy_code from cutover_plan_map);
  if v is not null then
    raise exception 'unmapped_plan: 대응 없는 옛 플랜 값 — 이관 중단' using errcode = 'P0001', detail = v;
  end if;
  select string_agg(distinct m.plan_code, ',') into v
    from cutover_plan_map m
   where not exists (select 1 from nomad_core.plans p where p.product_code = 'knowflow' and p.code = m.plan_code);
  if v is not null then
    raise exception 'core_seed_missing: nomad_core.plans(knowflow)에 없는 플랜' using errcode = '55000', detail = v;
  end if;
end $$;

-- 옛 user_id → 개인 조직
create temp table cutover_user_org on commit drop as
select p.id as user_id,
       (select array_agg(o.id)
          from nomad_core.organizations o
          join nomad_core.memberships m on m.organization_id = o.id and m.user_id = p.id and m.role = 'owner'
         where o.kind = 'personal' and o.created_by = p.id) as orgs
  from public.profiles p;
do $$
declare v text;
begin
  select string_agg(user_id::text || '=' || coalesce(array_length(orgs, 1), 0)::text, ', ') into v
    from cutover_user_org where coalesce(array_length(orgs, 1), 0) <> 1;
  if v is not null then
    raise exception 'personal_org_missing: 개인 조직이 정확히 1개가 아닌 사용자 — 이관 중단' using errcode = 'P0001', detail = v;
  end if;
end $$;
create temp table cutover_map on commit drop as
select user_id, orgs[1] as organization_id from cutover_user_org;
create unique index on cutover_map (user_id);

-- 대상이 비어 있어야 한다(재실행 방지)
do $$
declare v jsonb;
begin
  with c(t, n) as (
    select 'org_quotas', count(*) from nomad_knowflow.org_quotas union all
    select 'projects', count(*) from nomad_knowflow.projects union all
    select 'sources', count(*) from nomad_knowflow.sources union all
    select 'source_chunks', count(*) from nomad_knowflow.source_chunks union all
    select 'source_moments', count(*) from nomad_knowflow.source_moments union all
    select 'conversations', count(*) from nomad_knowflow.conversations union all
    select 'messages', count(*) from nomad_knowflow.messages union all
    select 'reports', count(*) from nomad_knowflow.reports union all
    select 'report_citations', count(*) from nomad_knowflow.report_citations union all
    select 'processing_jobs', count(*) from nomad_knowflow.processing_jobs union all
    select 'usage_events', count(*) from nomad_knowflow.usage_events union all
    select 'idempotency_keys', count(*) from nomad_knowflow_private.idempotency_keys union all
    select 'auth_rate_limits', count(*) from nomad_knowflow_private.auth_rate_limits union all
    select 'subscriptions(knowflow)', count(*) from nomad_core.subscriptions
      where product_code = 'knowflow' and organization_id in (select organization_id from cutover_map))
  select jsonb_object_agg(t, n) filter (where n > 0) into v from c;
  if v is not null then
    raise exception 'target_not_empty: 대상 표에 이미 행이 있다(재실행 거부)' using errcode = '55000', detail = v::text;
  end if;
end $$;

-- PDF 경로 형식: 첫 폴더 = 소유 user_id
do $$
declare n bigint;
begin
  select count(*) into n from public.sources
   where storage_path is not null and left(storage_path, 37) <> user_id::text || '/';
  if n > 0 then
    raise exception 'storage_path_unexpected: 첫 폴더가 user_id가 아닌 경로 %건', n using errcode = 'P0001';
  end if;
end $$;

-- ===== 복사 =====
insert into nomad_core.profiles (user_id, display_name, created_at, updated_at)
select p.id, p.display_name, p.created_at, p.updated_at from public.profiles p
on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, nomad_core.profiles.display_name),
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

insert into nomad_core.subscriptions (organization_id, product_code, plan_code, status, starts_at, ends_at)
select m.organization_id, 'knowflow', pm.plan_code, 'active', uq.created_at, null
  from public.user_quotas uq
  join cutover_map m on m.user_id = uq.user_id
  join cutover_plan_map pm on pm.legacy_code = uq.plan_code;

insert into nomad_knowflow.org_quotas (organization_id, period_start, used_questions, used_reports, used_source_jobs,
  used_video_seconds, created_at, updated_at)
select m.organization_id, uq.period_start, uq.used_questions, uq.used_reports, uq.used_source_jobs,
  uq.used_video_seconds, uq.created_at, uq.updated_at
  from public.user_quotas uq join cutover_map m on m.user_id = uq.user_id;

insert into nomad_knowflow.projects (id, organization_id, name, description, archived_at, deleted_at, summary,
  suggested_questions, created_at, updated_at)
select p.id, m.organization_id, p.name, p.description, p.archived_at, p.deleted_at, p.summary,
  p.suggested_questions, p.created_at, p.updated_at
  from public.projects p join cutover_map m on m.user_id = p.user_id;

insert into nomad_knowflow.sources (id, project_id, organization_id, source_type, title, original_url, storage_path,
  content_hash, status, error_code, error_message_safe, deleted_at, unavailable_at, video_id, channel_title,
  duration_seconds, metadata_checked_at, video_seconds_charged, video_seconds_charged_period, recheck_missing_count,
  created_at, updated_at)
select s.id, s.project_id, m.organization_id, s.source_type, s.title, s.original_url,
  case when s.storage_path is null then null else m.organization_id::text || substr(s.storage_path, 37) end,
  s.content_hash, s.status, s.error_code, s.error_message_safe, s.deleted_at, s.unavailable_at, s.video_id, s.channel_title,
  s.duration_seconds, s.metadata_checked_at, s.video_seconds_charged, s.video_seconds_charged_period, s.recheck_missing_count,
  s.created_at, s.updated_at
  from public.sources s join cutover_map m on m.user_id = s.user_id;

insert into nomad_knowflow.source_chunks (id, source_id, project_id, chunk_index, content, locator, embedding_model, created_at)
select id, source_id, project_id, chunk_index, content, locator, embedding_model, created_at from public.source_chunks;

insert into nomad_knowflow.source_moments (id, source_id, project_id, organization_id, moment_index, locator, title,
  description, created_at)
select sm.id, sm.source_id, sm.project_id, m.organization_id, sm.moment_index, sm.locator, sm.title, sm.description, sm.created_at
  from public.source_moments sm join cutover_map m on m.user_id = sm.user_id;

insert into nomad_knowflow.conversations (id, project_id, organization_id, title, deleted_at, created_at, updated_at)
select c.id, c.project_id, m.organization_id, c.title, null, c.created_at, c.updated_at
  from public.conversations c join cutover_map m on m.user_id = c.user_id;

insert into nomad_knowflow.messages (id, conversation_id, role, content, citation_metadata, created_at)
select id, conversation_id, role, content, citation_metadata, created_at from public.messages;

insert into nomad_knowflow.reports (id, project_id, organization_id, title, content, format, status, quota_charged_period,
  deleted_at, created_at, updated_at)
select r.id, r.project_id, m.organization_id, r.title, r.content, r.format, r.status, null, null, r.created_at, r.updated_at
  from public.reports r join cutover_map m on m.user_id = r.user_id;

insert into nomad_knowflow.report_citations (id, report_id, chunk_id, position, created_at)
select id, report_id, chunk_id, position, created_at from public.report_citations;

insert into nomad_knowflow.processing_jobs (id, organization_id, source_id, report_id, job_type, status, current_step,
  progress, attempt_count, max_attempts, locked_until, heartbeat_at, error_code, retryable, started_at, finished_at,
  created_at, updated_at)
select j.id, m.organization_id, j.source_id, j.report_id, j.job_type, j.status, j.current_step,
  j.progress, j.attempt_count, j.max_attempts, j.locked_until, j.heartbeat_at, j.error_code, j.retryable, j.started_at,
  j.finished_at, j.created_at, j.updated_at
  from public.processing_jobs j join cutover_map m on m.user_id = j.user_id;

insert into nomad_knowflow.usage_events (id, organization_id, project_id, event_type, provider, model, input_tokens,
  output_tokens, estimated_cost, created_at)
select u.id, m.organization_id, u.project_id, u.event_type, u.provider, u.model, u.input_tokens,
  u.output_tokens, u.estimated_cost, u.created_at
  from public.usage_events u left join cutover_map m on m.user_id = u.user_id;

insert into nomad_knowflow_private.idempotency_keys (organization_id, key, request_hash, resource_type, resource_id, created_at)
select m.organization_id, k.key, k.request_hash, k.resource_type, k.resource_id, k.created_at
  from public.idempotency_keys k join cutover_map m on m.user_id = k.user_id;

insert into nomad_knowflow_private.auth_rate_limits (scope, key_hash, window_start, hits)
select scope, key_hash, window_start, hits from public.auth_rate_limits;

set local session_replication_role = origin;

-- ===== 끝 검사 =====
-- 표마다 (옛 기대값 차집합 새 값) + (새 값 차집합 옛 기대값) = 0 이고 행 수 같음
create temp table cutover_value_check on commit drop as
with
o_profiles as (select p.id, p.created_at, p.updated_at from public.profiles p),
n_profiles as (select np.user_id, np.created_at, np.updated_at from nomad_core.profiles np where np.user_id in (select id from public.profiles)),
o_subs as (select m.organization_id, pm.plan_code, uq.created_at from public.user_quotas uq join cutover_map m using (user_id) join cutover_plan_map pm on pm.legacy_code = uq.plan_code),
n_subs as (select s.organization_id, s.plan_code, s.starts_at from nomad_core.subscriptions s where s.product_code = 'knowflow' and s.status = 'active' and s.organization_id in (select organization_id from cutover_map)),
o_quotas as (select m.organization_id, uq.period_start, uq.used_questions, uq.used_reports, uq.used_source_jobs, uq.used_video_seconds, uq.updated_at from public.user_quotas uq join cutover_map m using (user_id)),
n_quotas as (select organization_id, period_start, used_questions, used_reports, used_source_jobs, used_video_seconds, updated_at from nomad_knowflow.org_quotas),
o_projects as (select p.id, m.organization_id, p.deleted_at, p.created_at, p.updated_at from public.projects p join cutover_map m using (user_id)),
n_projects as (select id, organization_id, deleted_at, created_at, updated_at from nomad_knowflow.projects),
o_sources as (select s.id, s.project_id, m.organization_id, case when s.storage_path is null then null else m.organization_id::text || substr(s.storage_path, 37) end as storage_path, s.status, s.deleted_at, s.updated_at from public.sources s join cutover_map m using (user_id)),
n_sources as (select id, project_id, organization_id, storage_path, status, deleted_at, updated_at from nomad_knowflow.sources),
o_chunks as (select id, source_id, project_id, chunk_index, md5(content) as h from public.source_chunks),
n_chunks as (select id, source_id, project_id, chunk_index, md5(content) from nomad_knowflow.source_chunks),
o_moments as (select sm.id, sm.source_id, m.organization_id, sm.moment_index from public.source_moments sm join cutover_map m using (user_id)),
n_moments as (select id, source_id, organization_id, moment_index from nomad_knowflow.source_moments),
o_convs as (select c.id, c.project_id, m.organization_id, c.updated_at from public.conversations c join cutover_map m using (user_id)),
n_convs as (select id, project_id, organization_id, updated_at from nomad_knowflow.conversations),
o_msgs as (select id, conversation_id, role, md5(content) as h, created_at from public.messages),
n_msgs as (select id, conversation_id, role, md5(content), created_at from nomad_knowflow.messages),
o_reports as (select r.id, r.project_id, m.organization_id, r.status, r.updated_at from public.reports r join cutover_map m using (user_id)),
n_reports as (select id, project_id, organization_id, status, updated_at from nomad_knowflow.reports),
o_cits as (select id, report_id, chunk_id, position from public.report_citations),
n_cits as (select id, report_id, chunk_id, position from nomad_knowflow.report_citations),
o_jobs as (select j.id, m.organization_id, j.source_id, j.report_id, j.status, j.updated_at from public.processing_jobs j join cutover_map m using (user_id)),
n_jobs as (select id, organization_id, source_id, report_id, status, updated_at from nomad_knowflow.processing_jobs),
o_usage as (select u.id, m.organization_id, u.project_id, u.estimated_cost from public.usage_events u left join cutover_map m using (user_id)),
n_usage as (select id, organization_id, project_id, estimated_cost from nomad_knowflow.usage_events),
o_idem as (select m.organization_id, k.key, k.resource_id from public.idempotency_keys k join cutover_map m using (user_id)),
n_idem as (select organization_id, key, resource_id from nomad_knowflow_private.idempotency_keys),
o_rate as (select scope, key_hash, window_start, hits from public.auth_rate_limits),
n_rate as (select scope, key_hash, window_start, hits from nomad_knowflow_private.auth_rate_limits)
select * from (values
  ('profiles', (select count(*) from o_profiles), (select count(*) from n_profiles),
    (select count(*) from (table o_profiles except table n_profiles) x) + (select count(*) from (table n_profiles except table o_profiles) x)),
  ('subscriptions', (select count(*) from o_subs), (select count(*) from n_subs),
    (select count(*) from (table o_subs except table n_subs) x) + (select count(*) from (table n_subs except table o_subs) x)),
  ('org_quotas', (select count(*) from o_quotas), (select count(*) from n_quotas),
    (select count(*) from (table o_quotas except table n_quotas) x) + (select count(*) from (table n_quotas except table o_quotas) x)),
  ('projects', (select count(*) from o_projects), (select count(*) from n_projects),
    (select count(*) from (table o_projects except table n_projects) x) + (select count(*) from (table n_projects except table o_projects) x)),
  ('sources', (select count(*) from o_sources), (select count(*) from n_sources),
    (select count(*) from (table o_sources except table n_sources) x) + (select count(*) from (table n_sources except table o_sources) x)),
  ('source_chunks', (select count(*) from o_chunks), (select count(*) from n_chunks),
    (select count(*) from (table o_chunks except table n_chunks) x) + (select count(*) from (table n_chunks except table o_chunks) x)),
  ('source_moments', (select count(*) from o_moments), (select count(*) from n_moments),
    (select count(*) from (table o_moments except table n_moments) x) + (select count(*) from (table n_moments except table o_moments) x)),
  ('conversations', (select count(*) from o_convs), (select count(*) from n_convs),
    (select count(*) from (table o_convs except table n_convs) x) + (select count(*) from (table n_convs except table o_convs) x)),
  ('messages', (select count(*) from o_msgs), (select count(*) from n_msgs),
    (select count(*) from (table o_msgs except table n_msgs) x) + (select count(*) from (table n_msgs except table o_msgs) x)),
  ('reports', (select count(*) from o_reports), (select count(*) from n_reports),
    (select count(*) from (table o_reports except table n_reports) x) + (select count(*) from (table n_reports except table o_reports) x)),
  ('report_citations', (select count(*) from o_cits), (select count(*) from n_cits),
    (select count(*) from (table o_cits except table n_cits) x) + (select count(*) from (table n_cits except table o_cits) x)),
  ('processing_jobs', (select count(*) from o_jobs), (select count(*) from n_jobs),
    (select count(*) from (table o_jobs except table n_jobs) x) + (select count(*) from (table n_jobs except table o_jobs) x)),
  ('usage_events', (select count(*) from o_usage), (select count(*) from n_usage),
    (select count(*) from (table o_usage except table n_usage) x) + (select count(*) from (table n_usage except table o_usage) x)),
  ('idempotency_keys', (select count(*) from o_idem), (select count(*) from n_idem),
    (select count(*) from (table o_idem except table n_idem) x) + (select count(*) from (table n_idem except table o_idem) x)),
  ('auth_rate_limits', (select count(*) from o_rate), (select count(*) from n_rate),
    (select count(*) from (table o_rate except table n_rate) x) + (select count(*) from (table n_rate except table o_rate) x))
) v(t, n_old, n_new, diff);

-- FK 고아 · 복합 소유 불일치(replica 동안 FK 트리거가 꺼져 있었으므로 직접 확인)
create temp table cutover_orphan_check on commit drop as
select * from (values
  ('projects.organization_id', (select count(*) from nomad_knowflow.projects p where not exists (select 1 from nomad_core.organizations o where o.id = p.organization_id))),
  ('sources(project,org)', (select count(*) from nomad_knowflow.sources s where not exists (select 1 from nomad_knowflow.projects p where p.id = s.project_id and p.organization_id = s.organization_id))),
  ('source_chunks(source,project)', (select count(*) from nomad_knowflow.source_chunks c where not exists (select 1 from nomad_knowflow.sources s where s.id = c.source_id and s.project_id = c.project_id))),
  ('source_moments(source,project)', (select count(*) from nomad_knowflow.source_moments sm where not exists (select 1 from nomad_knowflow.sources s where s.id = sm.source_id and s.project_id = sm.project_id))),
  ('source_moments(project,org)', (select count(*) from nomad_knowflow.source_moments sm where not exists (select 1 from nomad_knowflow.projects p where p.id = sm.project_id and p.organization_id = sm.organization_id))),
  ('conversations(project,org)', (select count(*) from nomad_knowflow.conversations c where not exists (select 1 from nomad_knowflow.projects p where p.id = c.project_id and p.organization_id = c.organization_id))),
  ('messages.conversation_id', (select count(*) from nomad_knowflow.messages m where not exists (select 1 from nomad_knowflow.conversations c where c.id = m.conversation_id))),
  ('reports(project,org)', (select count(*) from nomad_knowflow.reports r where not exists (select 1 from nomad_knowflow.projects p where p.id = r.project_id and p.organization_id = r.organization_id))),
  ('report_citations.report_id', (select count(*) from nomad_knowflow.report_citations rc where not exists (select 1 from nomad_knowflow.reports r where r.id = rc.report_id))),
  ('report_citations.chunk_id', (select count(*) from nomad_knowflow.report_citations rc where rc.chunk_id is not null and not exists (select 1 from nomad_knowflow.source_chunks c where c.id = rc.chunk_id))),
  ('processing_jobs.organization_id', (select count(*) from nomad_knowflow.processing_jobs j where not exists (select 1 from nomad_core.organizations o where o.id = j.organization_id))),
  ('processing_jobs(source,org)', (select count(*) from nomad_knowflow.processing_jobs j where j.source_id is not null and not exists (select 1 from nomad_knowflow.sources s where s.id = j.source_id and s.organization_id = j.organization_id))),
  ('processing_jobs(report,org)', (select count(*) from nomad_knowflow.processing_jobs j where j.report_id is not null and not exists (select 1 from nomad_knowflow.reports r where r.id = j.report_id and r.organization_id = j.organization_id))),
  ('usage_events.organization_id', (select count(*) from nomad_knowflow.usage_events u where u.organization_id is not null and not exists (select 1 from nomad_core.organizations o where o.id = u.organization_id))),
  ('usage_events(project,org)', (select count(*) from nomad_knowflow.usage_events u where u.project_id is not null and not exists (select 1 from nomad_knowflow.projects p where p.id = u.project_id and (u.organization_id is null or p.organization_id = u.organization_id)))),
  ('org_quotas.organization_id', (select count(*) from nomad_knowflow.org_quotas q where not exists (select 1 from nomad_core.organizations o where o.id = q.organization_id))),
  ('idempotency_keys.organization_id', (select count(*) from nomad_knowflow_private.idempotency_keys k where not exists (select 1 from nomad_core.organizations o where o.id = k.organization_id))),
  ('profiles.user_id', (select count(*) from nomad_core.profiles p where not exists (select 1 from auth.users u where u.id = p.user_id))),
  ('subscriptions(org,plan)', (select count(*) from nomad_core.subscriptions s where s.product_code = 'knowflow' and (not exists (select 1 from nomad_core.organizations o where o.id = s.organization_id) or not exists (select 1 from nomad_core.plans p where p.product_code = s.product_code and p.code = s.plan_code))))
) v(t, n);

do $$
declare v text;
begin
  select string_agg(format('%s(old=%s,new=%s,diff=%s)', t, n_old, n_new, diff), ', ') into v
    from cutover_value_check where n_old <> n_new or diff <> 0;
  if v is not null then
    raise exception 'value_mismatch: 원본 대조 실패' using errcode = 'P0001', detail = v;
  end if;
  select string_agg(format('%s=%s', t, n), ', ') into v from cutover_orphan_check where n <> 0;
  if v is not null then
    raise exception 'orphan_rows: FK 고아·소유 불일치' using errcode = 'P0001', detail = v;
  end if;
end $$;

select t as "표", n_old as "원본", n_new as "새 표" from cutover_value_check order by t;

\if :apply
commit;
\echo '02_copy: APPLY 완료(commit)'
\else
rollback;
\echo '02_copy: dry-run 통과(rollback, 변경 없음). 적용은 -v apply=true'
\endif
