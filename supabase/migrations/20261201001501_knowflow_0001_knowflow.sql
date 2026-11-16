-- KNOWFLOW AI · 조직형(org안) 이식. 원본: KNOWFLOW-AI 레포 supabase/migrations 17개의 최종 상태.
-- 소유 = nomad_core.organizations(organization_id), 개인 사용자는 1인 조직. 읽기 = 멤버, 쓰기 = owner·admin·editor(RPC 안에서 확인).
-- profiles·plans → nomad_core, 한도는 nomad_core.org_plan_limit(조직, 'knowflow', 키)로 읽는다.
-- 전제: nomad_core.touch_updated_at()(task-011)·nomad_core.products 'knowflow'·plan_limits 시드는 코어가 제공한다.
-- 되돌림: drop schema nomad_knowflow cascade; drop schema nomad_knowflow_private cascade;
begin;

create extension if not exists pg_trgm with schema extensions;

create schema nomad_knowflow;
create schema nomad_knowflow_private;
revoke all on schema nomad_knowflow from public;
revoke all on schema nomad_knowflow_private from public, anon, authenticated, service_role;
grant usage on schema nomad_knowflow to anon, authenticated, service_role;

-- ===== 테이블 =====
-- 월 사용량 누적(한도 값은 plan_limits). 행은 첫 차감·프로젝트 생성 때 만든다.
create table nomad_knowflow.org_quotas (
  organization_id uuid primary key references nomad_core.organizations (id) on delete cascade,
  period_start date not null,
  used_questions integer not null default 0 check (used_questions >= 0),
  used_reports integer not null default 0 check (used_reports >= 0),
  used_source_jobs integer not null default 0 check (used_source_jobs >= 0),
  used_video_seconds integer not null default 0 check (used_video_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table nomad_knowflow.org_quotas is '조직별 월 사용량 누적. 한도는 nomad_core.plan_limits(knowflow). 갱신은 RPC만';

create table nomad_knowflow.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nomad_core.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  archived_at timestamptz,
  deleted_at timestamptz,
  summary text,
  suggested_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_questions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
comment on table nomad_knowflow.projects is '지식 프로젝트(동기화 대상: updated_at·deleted_at)';
create index projects_organization_id_idx on nomad_knowflow.projects (organization_id) where deleted_at is null;
create index projects_org_sync_idx on nomad_knowflow.projects (organization_id, updated_at);

create table nomad_knowflow.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid not null,
  source_type text not null check (source_type in ('pdf', 'url', 'youtube')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  original_url text check (original_url is null or (original_url ~* '^https?://' and char_length(original_url) <= 2048)),
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  error_code text,
  error_message_safe text,
  deleted_at timestamptz,
  unavailable_at timestamptz,
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_title text check (channel_title is null or char_length(btrim(channel_title)) between 1 and 300),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  metadata_checked_at timestamptz,
  video_seconds_charged integer check (video_seconds_charged is null or video_seconds_charged >= 0),
  video_seconds_charged_period date,
  recheck_missing_count integer not null default 0 check (recheck_missing_count between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade,
  constraint sources_type_columns_check check (
    (source_type = 'pdf' and storage_path is not null)
    or (source_type = 'url' and original_url is not null)
    or (source_type = 'youtube' and video_id is not null and original_url is not null
        and original_url = 'https://www.youtube.com/watch?v=' || video_id
        and storage_path is null and content_hash is null)
  ),
  constraint sources_youtube_columns_check check (
    source_type = 'youtube'
    or (video_id is null and channel_title is null and duration_seconds is null and metadata_checked_at is null
        and video_seconds_charged is null)
  ),
  constraint sources_video_seconds_charged_period_check check ((video_seconds_charged is null) = (video_seconds_charged_period is null)),
  unique (id, project_id)
);
comment on table nomad_knowflow.sources is '자료(pdf·url·youtube, 동기화 대상: updated_at·deleted_at)';
comment on column nomad_knowflow.sources.unavailable_at is '원본 비활성 시각. null이면 사용 가능';
create index sources_organization_id_idx on nomad_knowflow.sources (organization_id);
create index sources_org_sync_idx on nomad_knowflow.sources (organization_id, updated_at);
create index sources_project_id_idx on nomad_knowflow.sources (project_id);
create unique index sources_project_content_hash_key on nomad_knowflow.sources (project_id, content_hash)
  where content_hash is not null and deleted_at is null;
create unique index sources_project_video_id_key on nomad_knowflow.sources (project_id, video_id)
  where video_id is not null and deleted_at is null;
create index sources_youtube_metadata_checked_idx on nomad_knowflow.sources (metadata_checked_at) where video_id is not null;

create table nomad_knowflow.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  locator jsonb not null default '{}'::jsonb check (jsonb_typeof(locator) = 'object'),
  embedding_model text,
  content_tsv tsvector generated always as (to_tsvector('simple'::regconfig, content)) stored,
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references nomad_knowflow.sources (id, project_id) on delete cascade,
  unique (source_id, chunk_index)
);
comment on table nomad_knowflow.source_chunks is '자료 청크. 사용자 직접 접근 없음(RPC·서버만)';
create index source_chunks_project_id_idx on nomad_knowflow.source_chunks (project_id);
create index source_chunks_content_trgm_idx on nomad_knowflow.source_chunks using gin (content extensions.gin_trgm_ops);
create index source_chunks_content_tsv_idx on nomad_knowflow.source_chunks using gin (content_tsv);

create table nomad_knowflow.source_moments (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  organization_id uuid not null,
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
  foreign key (source_id, project_id) references nomad_knowflow.sources (id, project_id) on delete cascade,
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade,
  unique (source_id, moment_index)
);
comment on table nomad_knowflow.source_moments is '유튜브 장면 카드. 소유자 읽기만, 쓰기는 Worker RPC';
create index source_moments_organization_id_idx on nomad_knowflow.source_moments (organization_id);
create index source_moments_project_id_idx on nomad_knowflow.source_moments (project_id);

create table nomad_knowflow.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid not null,
  title text check (title is null or char_length(title) <= 200),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade
);
comment on table nomad_knowflow.conversations is '대화(동기화 대상: updated_at·deleted_at)';
create index conversations_organization_id_idx on nomad_knowflow.conversations (organization_id);
create index conversations_org_sync_idx on nomad_knowflow.conversations (organization_id, updated_at);
create index conversations_project_id_idx on nomad_knowflow.conversations (project_id);

create table nomad_knowflow.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references nomad_knowflow.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citation_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(citation_metadata) = 'object'),
  reply_to uuid,
  created_at timestamptz not null default now(),
  unique (id, conversation_id),
  -- 답변은 같은 대화의 질문을 참조한다(task-017). 이관한 과거 답변은 null
  foreign key (reply_to, conversation_id) references nomad_knowflow.messages (id, conversation_id) on delete cascade,
  check (reply_to is null or role = 'assistant')
);
comment on table nomad_knowflow.messages is '대화 메시지(추가만, 대화를 통해 소유 확인). 쓰기는 ask_question·save_answer RPC만';
create index messages_conversation_id_idx on nomad_knowflow.messages (conversation_id, created_at);
create unique index messages_one_answer_per_question on nomad_knowflow.messages (reply_to) where reply_to is not null;

create table nomad_knowflow.reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  content text not null default '',
  format text not null default 'markdown' check (format = 'markdown'),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  quota_charged_period date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references nomad_knowflow.projects (id, organization_id) on delete cascade
);
comment on table nomad_knowflow.reports is '리포트(동기화 대상: updated_at·deleted_at)';
comment on column nomad_knowflow.reports.quota_charged_period is 'monthly_reports 차감 표식(차감한 달). 환불 시 null(1회)';
create index reports_organization_id_idx on nomad_knowflow.reports (organization_id);
create index reports_org_sync_idx on nomad_knowflow.reports (organization_id, updated_at);
create index reports_project_id_idx on nomad_knowflow.reports (project_id);

create table nomad_knowflow.report_citations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references nomad_knowflow.reports (id) on delete cascade,
  chunk_id uuid references nomad_knowflow.source_chunks (id) on delete set null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);
comment on table nomad_knowflow.report_citations is '리포트 인용(chunk_id null = 원문 삭제됨)';
create index report_citations_report_id_idx on nomad_knowflow.report_citations (report_id, position);
create index report_citations_chunk_id_idx on nomad_knowflow.report_citations (chunk_id);

create table nomad_knowflow.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references nomad_core.organizations (id) on delete cascade,
  source_id uuid references nomad_knowflow.sources (id) on delete cascade,
  report_id uuid references nomad_knowflow.reports (id) on delete cascade,
  job_type text not null check (job_type in ('source_ingest', 'report_generate', 'source_recheck')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  current_step text,
  progress integer not null default 0 check (progress between 0 and 100),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  locked_until timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  retryable boolean not null default true,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempt_count <= max_attempts),
  check (status <> 'succeeded' or progress = 100),
  constraint processing_jobs_target_check check (
    (job_type in ('source_ingest', 'source_recheck') and source_id is not null)
    or (job_type = 'report_generate' and report_id is not null)
  )
);
comment on table nomad_knowflow.processing_jobs is '작업 큐(테이블 폴링). 상태 전이는 펜싱 RPC로만';
create index processing_jobs_organization_id_idx on nomad_knowflow.processing_jobs (organization_id);
create index processing_jobs_source_id_idx on nomad_knowflow.processing_jobs (source_id);
create index processing_jobs_report_id_idx on nomad_knowflow.processing_jobs (report_id);
create index processing_jobs_poll_idx on nomad_knowflow.processing_jobs (status, locked_until) where status in ('queued', 'running');
create unique index processing_jobs_one_active_per_source on nomad_knowflow.processing_jobs (source_id)
  where source_id is not null and job_type = 'source_ingest' and status in ('queued', 'running');
create unique index processing_jobs_one_active_recheck_per_source on nomad_knowflow.processing_jobs (source_id)
  where source_id is not null and job_type = 'source_recheck' and status in ('queued', 'running');
create unique index processing_jobs_one_active_per_report on nomad_knowflow.processing_jobs (report_id)
  where report_id is not null and status in ('queued', 'running');

create table nomad_knowflow.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references nomad_core.organizations (id) on delete set null,
  project_id uuid references nomad_knowflow.projects (id) on delete set null,
  event_type text not null,
  provider text,
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost bigint check (estimated_cost is null or estimated_cost >= 0),
  created_at timestamptz not null default now()
);
comment on table nomad_knowflow.usage_events is 'AI 사용 기록(원 단위 정수). 조직 비활성·삭제 시 organization_id 익명화 후 보관';
create index usage_events_organization_id_idx on nomad_knowflow.usage_events (organization_id, created_at desc);
create index usage_events_project_id_idx on nomad_knowflow.usage_events (project_id);

-- 내부 테이블(노출 안 함)
create table nomad_knowflow_private.idempotency_keys (
  organization_id uuid not null references nomad_core.organizations (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  request_hash text not null check (char_length(request_hash) between 1 and 128),
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);
comment on table nomad_knowflow_private.idempotency_keys is '멱등 키(RPC 안에서만 접근)';

create table nomad_knowflow_private.auth_rate_limits (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (scope, key_hash, window_start)
);
comment on table nomad_knowflow_private.auth_rate_limits is '인증·재시도 요청 한도 카운터(고정 윈도). 비식별 키만 저장';
create index auth_rate_limits_window_idx on nomad_knowflow_private.auth_rate_limits (window_start);

-- updated_at 트리거(nomad_core.touch_updated_at)
create trigger org_quotas_touch before update on nomad_knowflow.org_quotas for each row execute function nomad_core.touch_updated_at();
create trigger projects_touch before update on nomad_knowflow.projects for each row execute function nomad_core.touch_updated_at();
create trigger sources_touch before update on nomad_knowflow.sources for each row execute function nomad_core.touch_updated_at();
create trigger conversations_touch before update on nomad_knowflow.conversations for each row execute function nomad_core.touch_updated_at();
create trigger reports_touch before update on nomad_knowflow.reports for each row execute function nomad_core.touch_updated_at();
create trigger processing_jobs_touch before update on nomad_knowflow.processing_jobs for each row execute function nomad_core.touch_updated_at();

-- ===== RLS · 권한 =====
alter table nomad_knowflow.org_quotas enable row level security;
alter table nomad_knowflow.projects enable row level security;
alter table nomad_knowflow.sources enable row level security;
alter table nomad_knowflow.source_chunks enable row level security;
alter table nomad_knowflow.source_moments enable row level security;
alter table nomad_knowflow.conversations enable row level security;
alter table nomad_knowflow.messages enable row level security;
alter table nomad_knowflow.reports enable row level security;
alter table nomad_knowflow.report_citations enable row level security;
alter table nomad_knowflow.processing_jobs enable row level security;
alter table nomad_knowflow.usage_events enable row level security;
alter table nomad_knowflow_private.idempotency_keys enable row level security;
alter table nomad_knowflow_private.auth_rate_limits enable row level security;

revoke all on all tables in schema nomad_knowflow from public, anon, authenticated;
revoke all on all tables in schema nomad_knowflow_private from public, anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema nomad_knowflow to service_role;
-- 질문·답변·보고서 생성은 쿼터·멱등 RPC만(task-017): 서버도 messages insert·update, reports insert 불가
revoke insert, update on nomad_knowflow.messages from service_role;
revoke insert on nomad_knowflow.reports from service_role;
-- 사용자 롤은 SELECT만. 쓰기는 SECURITY DEFINER RPC로만. anon은 테이블 권한 없음(공개 읽기 없음)
grant select on
  nomad_knowflow.org_quotas, nomad_knowflow.projects, nomad_knowflow.sources, nomad_knowflow.source_moments,
  nomad_knowflow.conversations, nomad_knowflow.messages, nomad_knowflow.reports,
  nomad_knowflow.report_citations, nomad_knowflow.processing_jobs, nomad_knowflow.usage_events
to authenticated;

create policy org_quotas_select_org on nomad_knowflow.org_quotas for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null);
create policy projects_select_org on nomad_knowflow.projects for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null and deleted_at is null);
create policy sources_select_org on nomad_knowflow.sources for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null and deleted_at is null
    and exists (select 1 from nomad_knowflow.projects p where p.id = sources.project_id));
create policy source_moments_select_org on nomad_knowflow.source_moments for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null
    and exists (select 1 from nomad_knowflow.sources s where s.id = source_moments.source_id and s.unavailable_at is null));
create policy conversations_select_org on nomad_knowflow.conversations for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null and deleted_at is null
    and exists (select 1 from nomad_knowflow.projects p where p.id = conversations.project_id));
create policy messages_select_org on nomad_knowflow.messages for select to authenticated
  using (exists (select 1 from nomad_knowflow.conversations c where c.id = messages.conversation_id));
create policy reports_select_org on nomad_knowflow.reports for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null and deleted_at is null
    and exists (select 1 from nomad_knowflow.projects p where p.id = reports.project_id));
create policy report_citations_select_org on nomad_knowflow.report_citations for select to authenticated
  using (exists (select 1 from nomad_knowflow.reports r where r.id = report_citations.report_id));
create policy processing_jobs_select_org on nomad_knowflow.processing_jobs for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null
    and ((source_id is not null and exists (select 1 from nomad_knowflow.sources s where s.id = processing_jobs.source_id))
      or (report_id is not null and exists (select 1 from nomad_knowflow.reports r where r.id = processing_jobs.report_id))));
create policy usage_events_select_org on nomad_knowflow.usage_events for select to authenticated
  using (nomad_core.organization_role(organization_id) is not null);
-- 직접 접근 없음(명시적 거부)
create policy source_chunks_deny_all on nomad_knowflow.source_chunks for all to anon, authenticated using (false) with check (false);
create policy idempotency_keys_deny_all on nomad_knowflow_private.idempotency_keys for all to anon, authenticated using (false) with check (false);
create policy auth_rate_limits_deny_all on nomad_knowflow_private.auth_rate_limits for all to anon, authenticated using (false) with check (false);

-- ===== 내부 함수(nomad_knowflow_private, 누구에게도 EXECUTE 없음. DEFINER끼리는 소유자 권한) =====
create function nomad_knowflow_private.current_period_start() returns date
language sql stable set search_path = ''
as $$ select date_trunc('month', now() at time zone 'Asia/Seoul')::date; $$;

-- 한도 조회: 조직의 플랜(구독 없으면 C) 기준 plan_limits. 조직 없음·비활성·정의 없음이면 null(호출자는 거부한다, fail-closed)
create function nomad_knowflow_private.org_limit(p_org uuid, p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select nomad_core.org_plan_limit(p_org, 'knowflow', p_key); $$;

-- 쓰기 권한: 호출자(auth.uid())가 조직의 owner·admin·editor인가
create function nomad_knowflow_private.can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(nomad_core.organization_role(p_org) in ('owner', 'admin', 'editor'), false); $$;

-- 기능 잠금(task-007): 조직의 knowflow 기능 이용권이 없으면 KF403 feature_locked(HINT = 기능). 쓰기 경로만 부르고 읽기는 막지 않는다.
-- 인가(프로젝트·자료 조회) 뒤에 불러 존재를 노출하지 않는다. 구독이 끊기면 C 플랜 기능만 남는다(nomad_core.org_has_feature).
create function nomad_knowflow_private.require_feature(p_org uuid, p_feature text) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(nomad_core.org_has_feature(p_org, 'knowflow', p_feature), false) then
    raise exception 'feature_locked' using errcode = 'KF403', hint = p_feature;
  end if;
end;
$$;

-- 대화·질문 생성 잠금(knowledge_chat). 대화는 서버(service_role) 직접 insert, 질문·답변은 RPC만(task-017) — 트리거는 둘 다의 마지막 방어선.
-- 메시지는 role='user'(질문)만 잠그고 assistant 답변은 허용(잠기기 직전 질문의 답변 저장). 대화가 없으면 판정을 건너뛰고 FK(23503)에 맡긴다.
create function nomad_knowflow_private.require_chat_feature() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if tg_table_name = 'messages' then
    if new.role is distinct from 'user' then return new; end if;
    select c.organization_id into v_org from nomad_knowflow.conversations c where c.id = new.conversation_id;
    if not found then return new; end if;
  else
    v_org := new.organization_id;
  end if;
  perform nomad_knowflow_private.require_feature(v_org, 'knowledge_chat');
  return new;
end;
$$;
create trigger conversations_require_chat before insert on nomad_knowflow.conversations
  for each row execute function nomad_knowflow_private.require_chat_feature();
create trigger messages_require_chat before insert on nomad_knowflow.messages
  for each row execute function nomad_knowflow_private.require_chat_feature();

-- 보고서 생성 잠금(space_reports). 생성은 create_report RPC만(task-017), 트리거는 마지막 방어선
create function nomad_knowflow_private.require_reports_feature() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform nomad_knowflow_private.require_feature(new.organization_id, 'space_reports');
  return new;
end;
$$;
create trigger reports_require_feature before insert on nomad_knowflow.reports
  for each row execute function nomad_knowflow_private.require_reports_feature();

-- 월 경계 지연 초기화 + 행 보장
create function nomad_knowflow_private.ensure_quota(p_organization_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_period date := nomad_knowflow_private.current_period_start();
begin
  insert into nomad_knowflow.org_quotas (organization_id, period_start) values (p_organization_id, v_period)
  on conflict (organization_id) do nothing;
  update nomad_knowflow.org_quotas
     set period_start = v_period, used_questions = 0, used_reports = 0, used_source_jobs = 0, used_video_seconds = 0
   where organization_id = p_organization_id and period_start < v_period;
end;
$$;

-- 차감 본체. 한도 초과는 KF429 quota_exceeded(HINT = 자원 종류). 조건부 UPDATE 한 문장이라 동시 요청에도 초과 불가
create function nomad_knowflow_private.consume_quota_for(p_organization_id uuid, p_kind text, p_n integer default 1) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := case p_kind when 'questions' then 'monthly_questions' when 'reports' then 'monthly_reports'
                 when 'source_jobs' then 'monthly_source_jobs' when 'video_seconds' then 'monthly_video_seconds' end;
  v_limit integer;
  v_used integer;
begin
  if p_organization_id is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if v_key is null then raise exception 'invalid_quota_kind' using errcode = '22023'; end if;
  if p_n is null or p_n < 1 or p_n > (case when p_kind = 'video_seconds' then 86400 else 1000 end) then
    raise exception 'invalid_quota_amount' using errcode = '22023';
  end if;
  v_limit := nomad_knowflow_private.org_limit(p_organization_id, v_key);
  if v_limit is null then raise exception 'quota_not_initialized' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.ensure_quota(p_organization_id);

  update nomad_knowflow.org_quotas uq
     set used_questions = uq.used_questions + case when p_kind = 'questions' then p_n else 0 end,
         used_reports = uq.used_reports + case when p_kind = 'reports' then p_n else 0 end,
         used_source_jobs = uq.used_source_jobs + case when p_kind = 'source_jobs' then p_n else 0 end,
         used_video_seconds = uq.used_video_seconds + case when p_kind = 'video_seconds' then p_n else 0 end
   where uq.organization_id = p_organization_id
     and case p_kind when 'questions' then uq.used_questions when 'reports' then uq.used_reports
           when 'source_jobs' then uq.used_source_jobs else uq.used_video_seconds end + p_n <= v_limit
  returning case p_kind when 'questions' then uq.used_questions when 'reports' then uq.used_reports
              when 'source_jobs' then uq.used_source_jobs else uq.used_video_seconds end into v_used;
  if not found then
    raise exception 'quota_exceeded' using errcode = 'KF429', hint = p_kind;
  end if;
  return v_used;
end;
$$;


-- 환불: 이번 달 누적만, 0 아래로 내려가지 않음
create function nomad_knowflow_private.refund_quota(p_organization_id uuid, p_kind text, p_n integer default 1) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_period date := nomad_knowflow_private.current_period_start();
  v_used integer;
begin
  if p_organization_id is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if p_kind not in ('questions', 'reports', 'source_jobs', 'video_seconds') then
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;
  if p_n is null or p_n < 1 or p_n > (case when p_kind = 'video_seconds' then 86400 else 1000 end) then
    raise exception 'invalid_quota_amount' using errcode = '22023';
  end if;
  update nomad_knowflow.org_quotas uq
     set used_questions = greatest(uq.used_questions - case when p_kind = 'questions' then p_n else 0 end, 0),
         used_reports = greatest(uq.used_reports - case when p_kind = 'reports' then p_n else 0 end, 0),
         used_source_jobs = greatest(uq.used_source_jobs - case when p_kind = 'source_jobs' then p_n else 0 end, 0),
         used_video_seconds = greatest(uq.used_video_seconds - case when p_kind = 'video_seconds' then p_n else 0 end, 0)
   where uq.organization_id = p_organization_id and uq.period_start = v_period
  returning case p_kind when 'questions' then uq.used_questions when 'reports' then uq.used_reports
              when 'source_jobs' then uq.used_source_jobs else uq.used_video_seconds end into v_used;
  return v_used;
end;
$$;

create function nomad_knowflow_private.refund_source_video_seconds(p_source_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_organization_id uuid; v_charged integer; v_charged_period date;
begin
  select organization_id, video_seconds_charged, video_seconds_charged_period into v_organization_id, v_charged, v_charged_period
    from nomad_knowflow.sources
   where id = p_source_id and source_type = 'youtube' and video_seconds_charged > 0
   for update;
  if not found then return; end if;
  update nomad_knowflow.sources set video_seconds_charged = 0 where id = p_source_id;
  if v_charged_period = (select period_start from nomad_knowflow.org_quotas where organization_id = v_organization_id) then
    perform nomad_knowflow_private.refund_quota(v_organization_id, 'video_seconds', v_charged);
  end if;
end;
$$;

-- 보고서 쿼터 환불(task-017): 차감 표식(quota_charged_period)을 지우는 데 성공했을 때만 1회. ready 보고서는 환불 안 함.
-- 차감한 달이 이번 달일 때만 이번 달 사용량에서 뺀다(다른 달이면 표식만 지운다)
create function nomad_knowflow_private.refund_report_quota(p_report_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid; v_period date;
begin
  update nomad_knowflow.reports r set quota_charged_period = null
    from (select id, quota_charged_period from nomad_knowflow.reports
           where id = p_report_id and quota_charged_period is not null and status <> 'ready' for update) old
   where r.id = old.id
  returning r.organization_id, old.quota_charged_period into v_owner, v_period;
  if not found then return; end if;
  if v_period = nomad_knowflow_private.current_period_start() then
    perform nomad_knowflow_private.refund_quota(v_owner, 'reports', 1);
  end if;
end;
$$;

create function nomad_knowflow_private.claim_idempotency_key(
  p_org uuid, p_key text, p_request_hash text, p_resource_type text, p_resource_id uuid
) returns table (is_new boolean, resource_id uuid)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inserted integer;
  v_existing nomad_knowflow_private.idempotency_keys;
begin
  if p_org is null or p_key is null or char_length(p_key) not between 1 and 200
     or p_request_hash is null or char_length(p_request_hash) not between 1 and 128
     or p_resource_type is null or p_resource_id is null then
    raise exception 'invalid_idempotency_input' using errcode = '22023';
  end if;
  insert into nomad_knowflow_private.idempotency_keys (organization_id, key, request_hash, resource_type, resource_id)
  values (p_org, p_key, p_request_hash, p_resource_type, p_resource_id)
  on conflict (organization_id, key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return query select true, p_resource_id;
    return;
  end if;
  select * into v_existing from nomad_knowflow_private.idempotency_keys k where k.organization_id = p_org and k.key = p_key;
  if v_existing.request_hash <> p_request_hash or v_existing.resource_type <> p_resource_type then
    raise exception 'idempotency_conflict' using errcode = 'KF409';
  end if;
  return query select false, v_existing.resource_id;
end;
$$;

create function nomad_knowflow_private.sync_source_status(p_source_id uuid, p_status text, p_error_code text)
returns void language sql security definer set search_path = ''
as $$
  update nomad_knowflow.sources
     set status = p_status,
         error_code = case when p_status = 'failed' then p_error_code else null end,
         error_message_safe = case when p_status = 'failed' then '처리하지 못했습니다. 다시 시도해 주세요.' else null end
   where id = p_source_id;
$$;

create function nomad_knowflow_private.reap_expired_jobs() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_job record; v_count integer := 0;
begin
  for v_job in
    select id, organization_id, source_id, report_id, job_type from nomad_knowflow.processing_jobs
     where status = 'running' and locked_until < now() and attempt_count >= max_attempts
     for update skip locked
  loop
    update nomad_knowflow.processing_jobs
       set status = 'failed', error_code = 'lease_expired', finished_at = now(), locked_until = null
     where id = v_job.id;
    if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
      perform nomad_knowflow_private.sync_source_status(v_job.source_id, 'failed', 'lease_expired');
      perform nomad_knowflow_private.refund_quota(v_job.organization_id, 'source_jobs', 1);
      perform nomad_knowflow_private.refund_source_video_seconds(v_job.source_id);
    end if;
    if v_job.report_id is not null and v_job.job_type = 'report_generate' then
      perform nomad_knowflow_private.refund_report_quota(v_job.report_id);
      update nomad_knowflow.reports set status = 'failed' where id = v_job.report_id and status = 'generating';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 자료 등록 공통(PDF·URL). 프로젝트 잠금 → 멱등 키 → 자료 수 한도 → 쿼터 → 생성
create function nomad_knowflow_private.enqueue_job(
  p_project_id uuid, p_source_type text, p_title text, p_original_url text, p_storage_path text,
  p_content_hash text, p_idempotency_key text, p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_org uuid;
  v_source_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_claim record;
  v_max_sources integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_source_type is null or p_source_type not in ('pdf', 'url') then
    raise exception 'invalid_source_type' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 300 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_content_hash is not null and p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;

  -- 쓰기 권한이 있는 조직의 삭제되지 않은 프로젝트만. 타인 것·없는 것·삭제된 것·권한 없음은 같은 오류
  select id, organization_id into v_project_id, v_org from nomad_knowflow.projects
   where id = p_project_id and deleted_at is null and nomad_knowflow_private.can_write(organization_id)
   for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;

  if p_source_type = 'pdf' then
    -- 경로 첫 폴더 = 조직 id, 상위 경로 조작 금지
    if p_storage_path is null
       or split_part(p_storage_path, '/', 1) <> v_org::text
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

  select * into v_claim from nomad_knowflow_private.claim_idempotency_key(v_org, p_idempotency_key, p_request_hash, 'source', v_source_id);
  if not v_claim.is_new then
    select s.id, j.id into v_source_id, v_job_id
      from nomad_knowflow.sources s
      left join lateral (
        select id from nomad_knowflow.processing_jobs where source_id = s.id and job_type = 'source_ingest' order by created_at desc limit 1
      ) j on true
     where s.id = v_claim.resource_id and s.organization_id = v_org;
    if v_source_id is null then raise exception 'idempotency_resource_missing' using errcode = 'KF410'; end if;
    return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', true);
  end if;

  v_max_sources := nomad_knowflow_private.org_limit(v_org, 'max_sources_per_project');
  if v_max_sources is null then raise exception 'quota_not_initialized' using errcode = 'P0002'; end if;
  if (select count(*) from nomad_knowflow.sources where project_id = v_project_id and deleted_at is null) >= v_max_sources then
    raise exception 'source_limit_exceeded' using errcode = 'KF429';
  end if;

  perform nomad_knowflow_private.consume_quota_for(v_org, 'source_jobs', 1);

  insert into nomad_knowflow.sources (id, project_id, organization_id, source_type, title, original_url, storage_path, content_hash)
  values (v_source_id, v_project_id, v_org, p_source_type, btrim(p_title), p_original_url, p_storage_path, p_content_hash);
  insert into nomad_knowflow.processing_jobs (organization_id, source_id, job_type)
  values (v_org, v_source_id, 'source_ingest')
  returning id into v_job_id;
  return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', false);
end;
$$;

-- ===== 인증 한도(anon 호출 가능) =====
create function nomad_knowflow.consume_auth_rate_limit(p_scope text, p_key_hash text)
returns table (allowed boolean, retry_after integer)
language plpgsql security definer set search_path = ''
as $$
declare v_limit integer; v_window integer; v_start timestamptz; v_hits integer;
begin
  case p_scope
    when 'login_ip' then v_limit := 5; v_window := 60;
    when 'login_email' then v_limit := 5; v_window := 60;
    when 'signup_ip' then v_limit := 10; v_window := 3600;
    when 'reset_ip' then v_limit := 10; v_window := 3600;
    when 'reset_email' then v_limit := 3; v_window := 3600;
    else raise exception 'invalid_rate_scope' using errcode = '22023';
  end case;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_rate_key' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
  insert into nomad_knowflow_private.auth_rate_limits as r (scope, key_hash, window_start, hits)
  values (p_scope, p_key_hash, v_start, 1)
  on conflict (scope, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if random() < 0.01 then
    delete from nomad_knowflow_private.auth_rate_limits where window_start < now() - interval '1 day';
  end if;
  if v_hits > v_limit then
    return query select false, greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - now())))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

-- ===== 프로젝트 RPC =====
create function nomad_knowflow.create_project(p_organization_id uuid, p_name text, p_description text default null) returns nomad_knowflow.projects
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_max integer;
  v_row nomad_knowflow.projects;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  -- 조직이 없거나 쓰기 권한이 없으면 같은 오류(존재 여부 비노출)
  if p_organization_id is null or not nomad_knowflow_private.can_write(p_organization_id) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'invalid_project_name' using errcode = '22023'; end if;
  if v_desc is not null and char_length(v_desc) > 1000 then raise exception 'invalid_project_description' using errcode = '22023'; end if;
  v_max := nomad_knowflow_private.org_limit(p_organization_id, 'max_projects');
  if v_max is null then raise exception 'quota_not_initialized' using errcode = 'P0002'; end if;
  -- 조직 쿼터 행을 잠가 같은 조직의 동시 생성을 직렬화한다
  perform nomad_knowflow_private.ensure_quota(p_organization_id);
  perform 1 from nomad_knowflow.org_quotas where organization_id = p_organization_id for update;
  if (select count(*) from nomad_knowflow.projects where organization_id = p_organization_id and deleted_at is null) >= v_max then
    raise exception 'project_limit_exceeded' using errcode = 'KF429';
  end if;
  insert into nomad_knowflow.projects (organization_id, name, description) values (p_organization_id, v_name, v_desc) returning * into v_row;
  return v_row;
end;
$$;

create function nomad_knowflow.update_project(p_id uuid, p_patch jsonb) returns nomad_knowflow.projects
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row nomad_knowflow.projects;
  v_name text;
  v_desc text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name', 'description', 'archived')) then
    raise exception 'invalid_project_patch' using errcode = '22023';
  end if;
  select * into v_row from nomad_knowflow.projects where id = p_id and nomad_knowflow_private.can_write(organization_id) and deleted_at is null for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  if p_patch ? 'name' then
    if jsonb_typeof(p_patch -> 'name') <> 'string' then raise exception 'invalid_project_name' using errcode = '22023'; end if;
    v_name := btrim(p_patch ->> 'name');
    if char_length(v_name) not between 1 and 100 then raise exception 'invalid_project_name' using errcode = '22023'; end if;
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
    if jsonb_typeof(p_patch -> 'archived') <> 'boolean' then raise exception 'invalid_project_patch' using errcode = '22023'; end if;
    v_row.archived_at := case when (p_patch ->> 'archived')::boolean then coalesce(v_row.archived_at, now()) else null end;
  end if;
  update nomad_knowflow.projects
     set name = v_row.name, description = v_row.description, archived_at = v_row.archived_at
   where id = p_id returning * into v_row;
  return v_row;
end;
$$;

create function nomad_knowflow.delete_project(p_id uuid) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_deleted_at timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from nomad_knowflow.projects where id = p_id and nomad_knowflow_private.can_write(organization_id) and deleted_at is null for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from nomad_knowflow.processing_jobs j
     where j.status in ('queued', 'running')
       and (exists (select 1 from nomad_knowflow.sources s where s.id = j.source_id and s.project_id = p_id)
         or exists (select 1 from nomad_knowflow.reports r where r.id = j.report_id and r.project_id = p_id))
  ) then
    raise exception 'project_has_active_jobs' using errcode = 'KF409';
  end if;
  update nomad_knowflow.projects set deleted_at = now() where id = p_id returning deleted_at into v_deleted_at;
  return v_deleted_at;
end;
$$;

-- ===== 자료 RPC =====
create function nomad_knowflow.register_pdf_source(
  p_project_id uuid, p_title text, p_storage_path text, p_content_hash text, p_idempotency_key text, p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_size bigint; v_mime text; v_meta jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select organization_id into v_org from nomad_knowflow.projects
   where id = p_project_id and deleted_at is null and nomad_knowflow_private.can_write(organization_id) for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.require_feature(v_org, 'knowledge_base');
  if p_storage_path is null or p_storage_path !~ ('^' || v_org::text || '/' || p_project_id::text || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'invalid_storage_path' using errcode = '22023';
  end if;

  select metadata into v_meta from storage.objects where bucket_id = 'knowflow-sources' and name = p_storage_path;
  if not found then raise exception 'storage_object_missing' using errcode = '22023'; end if;
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  if v_size is null or v_size < 1 then raise exception 'storage_object_empty' using errcode = '22023'; end if;
  if v_size > 52428800 then raise exception 'file_too_large' using errcode = 'KF413'; end if;
  if v_mime <> 'application/pdf' then raise exception 'unsupported_media_type' using errcode = 'KF415'; end if;

  if p_content_hash is not null
     and not exists (select 1 from nomad_knowflow_private.idempotency_keys where organization_id = v_org and key = p_idempotency_key)
     and exists (select 1 from nomad_knowflow.sources where project_id = p_project_id and content_hash = p_content_hash and deleted_at is null) then
    raise exception 'duplicate_content' using errcode = 'KF409';
  end if;
  return nomad_knowflow_private.enqueue_job(p_project_id, 'pdf', btrim(p_title), null, p_storage_path, p_content_hash, p_idempotency_key, p_request_hash);
end;
$$;

-- 유튜브 자료 등록(service_role 전용: 웹 서버가 세션 멤버십·기능 플래그·videos.list 확인 뒤 조직 id를 넘긴다)
create function nomad_knowflow.register_youtube_source(
  p_organization_id uuid, p_project_id uuid, p_video_id text, p_title text, p_channel_title text,
  p_duration_seconds integer, p_idempotency_key text, p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_project_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_inserted integer;
  v_existing nomad_knowflow_private.idempotency_keys;
  v_max_sources integer;
  v_max_video integer;
begin
  if p_organization_id is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid_video_id' using errcode = '22023'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 300 then raise exception 'invalid_title' using errcode = '22023'; end if;
  if p_channel_title is null or char_length(btrim(p_channel_title)) not between 1 and 300 then
    raise exception 'invalid_channel_title' using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 1 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200
     or p_request_hash is null or char_length(p_request_hash) not between 1 and 128 then
    raise exception 'invalid_idempotency_input' using errcode = '22023';
  end if;

  select id into v_project_id from nomad_knowflow.projects
   where id = p_project_id and organization_id = p_organization_id and deleted_at is null for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.require_feature(p_organization_id, 'knowledge_base');

  insert into nomad_knowflow_private.idempotency_keys (organization_id, key, request_hash, resource_type, resource_id)
  values (p_organization_id, p_idempotency_key, p_request_hash, 'source', v_source_id)
  on conflict (organization_id, key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into v_existing from nomad_knowflow_private.idempotency_keys k where k.organization_id = p_organization_id and k.key = p_idempotency_key;
    if v_existing.request_hash <> p_request_hash or v_existing.resource_type <> 'source' then
      raise exception 'idempotency_conflict' using errcode = 'KF409';
    end if;
    select s.id, j.id into v_source_id, v_job_id
      from nomad_knowflow.sources s
      left join lateral (
        select id from nomad_knowflow.processing_jobs where source_id = s.id and job_type = 'source_ingest' order by created_at desc limit 1
      ) j on true
     where s.id = v_existing.resource_id and s.organization_id = p_organization_id;
    if v_source_id is null then raise exception 'idempotency_resource_missing' using errcode = 'KF410'; end if;
    return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', true);
  end if;

  if exists (select 1 from nomad_knowflow.sources where project_id = v_project_id and video_id = p_video_id and deleted_at is null) then
    raise exception 'duplicate_video' using errcode = '23505';
  end if;

  v_max_sources := nomad_knowflow_private.org_limit(p_organization_id, 'max_sources_per_project');
  v_max_video := nomad_knowflow_private.org_limit(p_organization_id, 'max_video_seconds');
  if v_max_sources is null or v_max_video is null then raise exception 'quota_not_initialized' using errcode = 'P0002'; end if;
  if p_duration_seconds > v_max_video then raise exception 'video_too_long' using errcode = 'KF413'; end if;
  if (select count(*) from nomad_knowflow.sources where project_id = v_project_id and deleted_at is null) >= v_max_sources then
    raise exception 'source_limit_exceeded' using errcode = 'KF429';
  end if;

  perform nomad_knowflow_private.consume_quota_for(p_organization_id, 'source_jobs', 1);
  perform nomad_knowflow_private.consume_quota_for(p_organization_id, 'video_seconds', p_duration_seconds);

  insert into nomad_knowflow.sources (
    id, project_id, organization_id, source_type, title, original_url,
    video_id, channel_title, duration_seconds, metadata_checked_at, video_seconds_charged, video_seconds_charged_period
  ) values (
    v_source_id, v_project_id, p_organization_id, 'youtube', btrim(p_title), 'https://www.youtube.com/watch?v=' || p_video_id,
    p_video_id, btrim(p_channel_title), p_duration_seconds, now(), p_duration_seconds, nomad_knowflow_private.current_period_start()
  );
  insert into nomad_knowflow.processing_jobs (organization_id, source_id, job_type)
  values (p_organization_id, v_source_id, 'source_ingest') returning id into v_job_id;
  return jsonb_build_object('source_id', v_source_id, 'job_id', v_job_id, 'duplicate', false);
end;
$$;

create function nomad_knowflow.get_source_chunks(
  p_source_id uuid, p_after_index integer default null, p_limit integer default 50, p_around_chunk_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_unavailable timestamptz; v_around text; v_target integer; v_start integer;
  v_chunks jsonb; v_count integer; v_first integer; v_last integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit not between 1 and 100
     or (p_after_index is not null and p_after_index < 0)
     or (p_after_index is not null and p_around_chunk_id is not null) then
    raise exception 'invalid_chunks_input' using errcode = '22023';
  end if;
  select s.status, s.unavailable_at into v_status, v_unavailable
    from nomad_knowflow.sources s join nomad_knowflow.projects p on p.id = s.project_id
   where s.id = p_source_id and s.deleted_at is null and p.deleted_at is null
     and nomad_core.organization_role(s.organization_id) is not null;
  if not found then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  if v_unavailable is not null then
    return jsonb_build_object('chunks', '[]'::jsonb, 'has_more', false, 'has_before', false, 'around', null, 'unavailable', true);
  end if;
  if v_status <> 'completed' then raise exception 'source_not_ready' using errcode = 'KF409'; end if;

  if p_around_chunk_id is not null then
    select chunk_index into v_target from nomad_knowflow.source_chunks where id = p_around_chunk_id and source_id = p_source_id;
    if found then
      v_around := 'found';
      select coalesce(min(b.chunk_index), v_target) into v_start
        from (select chunk_index from nomad_knowflow.source_chunks
               where source_id = p_source_id and chunk_index < v_target order by chunk_index desc limit p_limit / 2) b;
    else
      v_around := 'not_found';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'chunk_index', c.chunk_index, 'content', c.content, 'locator', c.locator)
                            order by c.chunk_index) filter (where c.rn <= p_limit), '[]'::jsonb),
         count(*), min(c.chunk_index), max(c.chunk_index) filter (where c.rn <= p_limit)
    into v_chunks, v_count, v_first, v_last
    from (select sc.id, sc.chunk_index, sc.content, sc.locator, row_number() over (order by sc.chunk_index) as rn
            from nomad_knowflow.source_chunks sc
           where sc.source_id = p_source_id
             and (p_after_index is null or sc.chunk_index > p_after_index)
             and (v_start is null or sc.chunk_index >= v_start)
           order by sc.chunk_index limit p_limit + 1) c;

  return jsonb_build_object(
    'chunks', v_chunks, 'has_more', v_count > p_limit,
    'has_before', v_first is not null and exists (
      select 1 from nomad_knowflow.source_chunks where source_id = p_source_id and chunk_index < v_first),
    'around', v_around, 'unavailable', false);
end;
$$;

create function nomad_knowflow.delete_sources(p_project_id uuid, p_source_ids uuid[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_ids uuid[]; v_owned integer; v_deleted integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_source_ids is null or cardinality(p_source_ids) not between 1 and 100 or array_position(p_source_ids, null) is not null then
    raise exception 'invalid_source_ids' using errcode = '22023';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_source_ids) x;
  perform 1 from nomad_knowflow.projects where id = p_project_id and nomad_knowflow_private.can_write(organization_id) and deleted_at is null for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  select count(*) into v_owned from (
    select 1 from nomad_knowflow.sources where id = any (v_ids) and project_id = p_project_id and nomad_knowflow_private.can_write(organization_id) for update
  ) s;
  if v_owned <> cardinality(v_ids) then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  update nomad_knowflow.sources set deleted_at = now() where id = any (v_ids) and deleted_at is null;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create function nomad_knowflow.retry_source(p_source_id uuid, p_idempotency_key text, p_request_hash text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source nomad_knowflow.sources;
  v_job_id uuid := gen_random_uuid();
  v_claim record;
  v_last_retryable boolean;
  v_window_start timestamptz;
  v_hits integer;
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select s.* into v_source
    from nomad_knowflow.sources s join nomad_knowflow.projects p on p.id = s.project_id
   where s.id = p_source_id and nomad_knowflow_private.can_write(s.organization_id) and s.deleted_at is null and p.deleted_at is null
   for update of s;
  if not found then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.require_feature(v_source.organization_id, 'knowledge_base');

  select * into v_claim from nomad_knowflow_private.claim_idempotency_key(v_source.organization_id, p_idempotency_key, p_request_hash, 'job', v_job_id);
  if not v_claim.is_new then
    if not exists (select 1 from nomad_knowflow.processing_jobs where id = v_claim.resource_id and nomad_knowflow_private.can_write(organization_id)) then
      raise exception 'idempotency_resource_missing' using errcode = 'KF410';
    end if;
    return jsonb_build_object('job_id', v_claim.resource_id, 'duplicate', true);
  end if;

  if v_source.status = 'completed' then raise exception 'source_already_completed' using errcode = '22023'; end if;
  if v_source.status <> 'failed' or exists (
    select 1 from nomad_knowflow.processing_jobs where source_id = p_source_id and job_type = 'source_ingest' and status in ('queued', 'running')
  ) then
    raise exception 'source_has_active_job' using errcode = 'KF409';
  end if;
  select j.retryable into v_last_retryable from nomad_knowflow.processing_jobs j
   where j.source_id = p_source_id and j.job_type = 'source_ingest' order by j.created_at desc, j.id desc limit 1;
  if v_last_retryable is false then raise exception 'source_not_retryable' using errcode = 'KF422'; end if;
  if v_source.source_type = 'youtube' and coalesce(v_source.video_seconds_charged, 0) = 0 and v_source.duration_seconds is null then
    raise exception 'source_not_retryable' using errcode = 'KF422';
  end if;
  if (select count(*) from nomad_knowflow.processing_jobs where source_id = p_source_id and job_type = 'source_ingest') >= 6 then
    raise exception 'retry_limit_exceeded' using errcode = 'KF429';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  insert into nomad_knowflow_private.auth_rate_limits as r (scope, key_hash, window_start, hits)
  values ('source_retry', encode(sha256(convert_to(v_uid::text, 'UTF8')), 'hex'), v_window_start, 1)
  on conflict (scope, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if v_hits > 10 then
    raise exception 'retry_rate_limited' using errcode = 'KF429',
      detail = greatest(1, ceil(extract(epoch from (v_window_start + interval '60 seconds' - now()))))::integer::text;
  end if;

  begin
    v_kind := 'source_jobs';
    perform nomad_knowflow_private.consume_quota_for(v_source.organization_id, 'source_jobs', 1);
    if v_source.source_type = 'youtube' and coalesce(v_source.video_seconds_charged, 0) = 0 then
      v_kind := 'video_seconds';
      perform nomad_knowflow_private.consume_quota_for(v_source.organization_id, 'video_seconds', v_source.duration_seconds);
      update nomad_knowflow.sources
         set video_seconds_charged = v_source.duration_seconds, video_seconds_charged_period = nomad_knowflow_private.current_period_start()
       where id = p_source_id;
    end if;
  exception when sqlstate 'KF429' then
    raise exception 'quota_exceeded' using errcode = 'KF429', hint = v_kind,
      detail = greatest(1, ceil(extract(epoch from (
        (nomad_knowflow_private.current_period_start() + interval '1 month')::timestamp at time zone 'Asia/Seoul' - now()))))::integer::text;
  end;

  insert into nomad_knowflow.processing_jobs (id, organization_id, source_id, job_type) values (v_job_id, v_source.organization_id, p_source_id, 'source_ingest');
  perform nomad_knowflow_private.sync_source_status(p_source_id, 'queued', null);
  return jsonb_build_object('job_id', v_job_id, 'duplicate', false);
end;
$$;

create function nomad_knowflow.list_project_jobs(
  p_project_id uuid, p_status text default null, p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null, p_limit integer default 21
) returns table (
  id uuid, job_type text, status text, current_step text, progress integer, attempt_count integer, error_code text,
  retryable boolean, source_id uuid, source_status text, report_id uuid, created_at timestamptz,
  started_at timestamptz, finished_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit not between 1 and 101
     or (p_status is not null and p_status not in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
     or (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'invalid_list_input' using errcode = '22023';
  end if;
  perform 1 from nomad_knowflow.projects p where p.id = p_project_id;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  return query
    select j.id, j.job_type, j.status, j.current_step, j.progress, j.attempt_count, j.error_code, j.retryable,
           j.source_id, s.status, j.report_id, j.created_at, j.started_at, j.finished_at
      from nomad_knowflow.processing_jobs j
      left join nomad_knowflow.sources s on s.id = j.source_id and s.project_id = p_project_id
      left join nomad_knowflow.reports r on r.id = j.report_id and r.project_id = p_project_id
     where (s.id is not null or r.id is not null)
       and j.job_type <> 'source_recheck'
       and (p_status is null or j.status = p_status)
       and (p_cursor_created_at is null or (j.created_at, j.id) < (p_cursor_created_at, p_cursor_id))
     order by j.created_at desc, j.id desc
     limit p_limit;
end;
$$;

-- ===== Worker RPC(service_role) =====
create function nomad_knowflow.claim_job(p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs;
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then raise exception 'invalid_lease' using errcode = '22023'; end if;
  perform nomad_knowflow_private.reap_expired_jobs();
  select * into v_job from nomad_knowflow.processing_jobs
   where status = 'queued' or (status = 'running' and locked_until < now())
   order by (job_type = 'source_recheck'), created_at, id
   limit 1 for update skip locked;
  if not found then return null; end if;
  update nomad_knowflow.processing_jobs
     set status = 'running', attempt_count = attempt_count + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now(),
         started_at = coalesce(started_at, now()), progress = 0, current_step = null, error_code = null
   where id = v_job.id returning * into v_job;
  if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
    perform nomad_knowflow_private.sync_source_status(v_job.source_id, 'processing', null);
  end if;
  return to_jsonb(v_job);
end;
$$;

create function nomad_knowflow.heartbeat_job(p_job_id uuid, p_attempt integer, p_lease_seconds integer default 120) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then raise exception 'invalid_lease' using errcode = '22023'; end if;
  update nomad_knowflow.processing_jobs
     set heartbeat_at = now(), locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$$;

create function nomad_knowflow.progress_job(p_job_id uuid, p_attempt integer, p_step text, p_progress integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_progress is null or p_progress not between 0 and 99 or p_step is null or char_length(p_step) > 64 then
    raise exception 'invalid_progress' using errcode = '22023';
  end if;
  update nomad_knowflow.processing_jobs set current_step = p_step, progress = p_progress
   where id = p_job_id and status = 'running' and attempt_count = p_attempt;
  return found;
end;
$$;

create function nomad_knowflow.complete_job(p_job_id uuid, p_attempt integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs;
begin
  update nomad_knowflow.processing_jobs
     set status = 'succeeded', progress = 100, finished_at = now(), locked_until = null, error_code = null
   where id = p_job_id and status = 'running' and attempt_count = p_attempt
  returning * into v_job;
  if not found then return false; end if;
  if v_job.source_id is not null and v_job.job_type = 'source_ingest' then
    perform nomad_knowflow_private.sync_source_status(v_job.source_id, 'completed', null);
  end if;
  return true;
end;
$$;

create function nomad_knowflow.fail_job(p_job_id uuid, p_attempt integer, p_error_code text, p_retryable boolean default true) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_job nomad_knowflow.processing_jobs;
  v_code text := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'unknown' end;
  v_ingest boolean;
  v_report boolean;
begin
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and status = 'running' and attempt_count = p_attempt for update;
  if not found then return 'stale'; end if;
  v_ingest := v_job.source_id is not null and v_job.job_type = 'source_ingest';
  v_report := v_job.report_id is not null and v_job.job_type = 'report_generate';
  if coalesce(p_retryable, false) and v_job.attempt_count < v_job.max_attempts then
    update nomad_knowflow.processing_jobs set status = 'queued', locked_until = null, error_code = v_code where id = v_job.id;
    if v_ingest then perform nomad_knowflow_private.sync_source_status(v_job.source_id, 'queued', null); end if;
    return 'requeued';
  end if;
  update nomad_knowflow.processing_jobs
     set status = 'failed', error_code = v_code, finished_at = now(), locked_until = null,
         retryable = coalesce(p_retryable, false) or v_code = 'no_handler'
   where id = v_job.id;
  if v_ingest then
    perform nomad_knowflow_private.sync_source_status(v_job.source_id, 'failed', v_code);
    perform nomad_knowflow_private.refund_quota(v_job.organization_id, 'source_jobs', 1);
    perform nomad_knowflow_private.refund_source_video_seconds(v_job.source_id);
  end if;
  if v_report then
    -- 보고서 생성 최종 실패: 보고서 failed + 월 보고서 쿼터 환불(task-017)
    perform nomad_knowflow_private.refund_report_quota(v_job.report_id);
    update nomad_knowflow.reports set status = 'failed' where id = v_job.report_id and status = 'generating';
  end if;
  return 'failed';
end;
$$;

create function nomad_knowflow.replace_source_chunks(p_job_id uuid, p_attempt integer, p_chunks jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_project_id uuid;
begin
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 20000 then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_chunks) e
     where jsonb_typeof(e) <> 'object'
        or case when jsonb_typeof(e -> 'chunk_index') = 'number'
                then (e ->> 'chunk_index')::numeric <> trunc((e ->> 'chunk_index')::numeric)
                  or (e ->> 'chunk_index')::numeric not between 0 and 2147483647
                else true end
        or jsonb_typeof(e -> 'content') <> 'string'
        or char_length(e ->> 'content') = 0
        or jsonb_typeof(e -> 'locator') <> 'object'
  ) then raise exception 'invalid_chunks' using errcode = '22023'; end if;
  if (select count(distinct (e ->> 'chunk_index')::numeric) <> count(*) from jsonb_array_elements(p_chunks) e) then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest' for update;
  if not found then return false; end if;
  select project_id into v_project_id from nomad_knowflow.sources where id = v_job.source_id and deleted_at is null;
  if not found then return false; end if;
  delete from nomad_knowflow.source_chunks where source_id = v_job.source_id;
  insert into nomad_knowflow.source_chunks (source_id, project_id, chunk_index, content, locator)
  select v_job.source_id, v_project_id, (e ->> 'chunk_index')::integer, e ->> 'content', e -> 'locator'
    from jsonb_array_elements(p_chunks) e;
  return true;
end;
$$;

create function nomad_knowflow.replace_source_moments(p_job_id uuid, p_attempt integer, p_moments jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_source nomad_knowflow.sources;
begin
  if p_moments is null or jsonb_typeof(p_moments) <> 'array' or jsonb_array_length(p_moments) > 500 then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_moments) e
     where jsonb_typeof(e) <> 'object'
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
  ) then raise exception 'invalid_moments' using errcode = '22023'; end if;
  if (select count(distinct (e ->> 'moment_index')::numeric) <> count(*) from jsonb_array_elements(p_moments) e) then
    raise exception 'invalid_moments' using errcode = '22023';
  end if;
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_ingest' for update;
  if not found then return false; end if;
  select * into v_source from nomad_knowflow.sources where id = v_job.source_id and deleted_at is null;
  if not found then return false; end if;
  if v_source.source_type <> 'youtube' then raise exception 'not_youtube_source' using errcode = '22023'; end if;
  if v_source.duration_seconds is not null and exists (
    select 1 from jsonb_array_elements(p_moments) e where (e -> 'locator' ->> 't_end')::numeric > v_source.duration_seconds
  ) then raise exception 'invalid_moments' using errcode = '22023'; end if;
  delete from nomad_knowflow.source_moments where source_id = v_source.id;
  insert into nomad_knowflow.source_moments (source_id, project_id, organization_id, moment_index, locator, title, description)
  select v_source.id, v_source.project_id, v_source.organization_id, (e ->> 'moment_index')::integer,
         jsonb_build_object('t_start', e -> 'locator' -> 't_start', 't_end', e -> 'locator' -> 't_end'),
         btrim(e ->> 'title'), btrim(e ->> 'description')
    from jsonb_array_elements(p_moments) e;
  return true;
end;
$$;

create function nomad_knowflow.sweep_source_rechecks(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_purged integer; v_enqueued integer; v_cleaned integer; v_stale integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'invalid_sweep_limit' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('nomad_knowflow.sweep_source_rechecks'));
  update nomad_knowflow.sources
     set title = '확인할 수 없는 영상', channel_title = null, duration_seconds = null
   where video_id is not null and (channel_title is not null or duration_seconds is not null)
     and (unavailable_at is not null or metadata_checked_at is null or metadata_checked_at <= now() - interval '29 days');
  get diagnostics v_purged = row_count;

  insert into nomad_knowflow.processing_jobs (organization_id, source_id, job_type)
  select s.organization_id, s.id, 'source_recheck'
    from nomad_knowflow.sources s join nomad_knowflow.projects p on p.id = s.project_id
   where s.video_id is not null and s.deleted_at is null and p.deleted_at is null and s.unavailable_at is null
     and (s.metadata_checked_at is null or s.metadata_checked_at <= now() - interval '21 days')
     and not exists (
       select 1 from nomad_knowflow.processing_jobs j
        where j.source_id = s.id and j.job_type = 'source_recheck'
          and (j.status in ('queued', 'running') or j.created_at > now() - interval '20 hours'))
   order by exists (
              select 1 from nomad_knowflow.processing_jobs j
               where j.source_id = s.id and j.job_type = 'source_recheck' and j.status = 'failed' and j.created_at > now() - interval '3 days'),
            (select max(j.created_at) from nomad_knowflow.processing_jobs j where j.source_id = s.id and j.job_type = 'source_recheck') nulls first,
            s.metadata_checked_at nulls first, s.id
   limit p_limit
  on conflict (source_id) where source_id is not null and job_type = 'source_recheck' and status in ('queued', 'running') do nothing;
  get diagnostics v_enqueued = row_count;

  delete from nomad_knowflow.processing_jobs
   where job_type = 'source_recheck' and status = 'failed' and coalesce(finished_at, updated_at) < now() - interval '7 days';
  get diagnostics v_cleaned = row_count;
  select count(*) into v_stale from nomad_knowflow.processing_jobs
   where job_type = 'source_recheck' and status = 'queued' and created_at < now() - interval '24 hours';
  return jsonb_build_object('enqueued', v_enqueued, 'purged', v_purged, 'cleaned', v_cleaned, 'stale_queued', v_stale);
end;
$$;

create function nomad_knowflow.apply_source_recheck(p_job_id uuid, p_attempt integer, p_result jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_job nomad_knowflow.processing_jobs; v_kind text := p_result ->> 'kind'; v_missing integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' or v_kind is null or v_kind not in ('available', 'unavailable', 'missing') then
    raise exception 'invalid_recheck_result' using errcode = '22023';
  end if;
  if v_kind = 'available' and (
    jsonb_typeof(p_result -> 'title') is distinct from 'string'
    or char_length(btrim(p_result ->> 'title')) not between 1 and 300
    or jsonb_typeof(p_result -> 'channel_title') is distinct from 'string'
    or char_length(btrim(p_result ->> 'channel_title')) not between 1 and 300
    or case when jsonb_typeof(p_result -> 'duration_seconds') = 'number'
            then (p_result ->> 'duration_seconds')::numeric <> trunc((p_result ->> 'duration_seconds')::numeric)
              or (p_result ->> 'duration_seconds')::numeric not between 1 and 2147483647
            else true end
  ) then raise exception 'invalid_recheck_result' using errcode = '22023'; end if;
  select * into v_job from nomad_knowflow.processing_jobs
   where id = p_job_id and attempt_count = p_attempt and status = 'running' and job_type = 'source_recheck' for update;
  if not found then return false; end if;
  if v_kind = 'available' then
    update nomad_knowflow.sources
       set title = btrim(p_result ->> 'title'), channel_title = btrim(p_result ->> 'channel_title'),
           duration_seconds = (p_result ->> 'duration_seconds')::integer, metadata_checked_at = now(), recheck_missing_count = 0
     where id = v_job.source_id and video_id is not null and deleted_at is null and unavailable_at is null;
    return true;
  end if;
  if v_kind = 'missing' then
    update nomad_knowflow.sources set recheck_missing_count = recheck_missing_count + 1
     where id = v_job.source_id and video_id is not null and deleted_at is null and unavailable_at is null
    returning recheck_missing_count into v_missing;
    if v_missing is null or v_missing < 2 then return true; end if;
  end if;
  update nomad_knowflow.sources
     set unavailable_at = coalesce(unavailable_at, now()), title = '확인할 수 없는 영상',
         channel_title = null, duration_seconds = null, metadata_checked_at = now()
   where id = v_job.source_id and video_id is not null and deleted_at is null;
  return true;
end;
$$;

-- ===== 질문·답변·보고서(task-017): 월 쿼터를 DB가 보장. 테이블 직접 insert는 서버도 불가 =====
-- 질문: 대화 잠금 → 기능(knowledge_chat) → 멱등 키(요청 해시 = 대화·내용) → monthly_questions 차감 → user 메시지 저장.
-- 같은 키·같은 내용 재요청은 같은 메시지(차감 1회, 답변이 있으면 answer_id), 같은 키·다른 내용은 KF409. 잠기면 같은 키도 KF403
create function nomad_knowflow.ask_question(p_conversation_id uuid, p_content text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
  v_org uuid;
  v_message_id uuid := gen_random_uuid();
  v_claim record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 20000 then
    raise exception 'invalid_content' using errcode = '22023';
  end if;
  -- 쓰기 권한(owner·admin·editor)이 있는 조직의 대화만. 타인 것·없는 것·삭제된 것·viewer는 같은 오류
  select c.id, c.organization_id into v_conv, v_org
    from nomad_knowflow.conversations c join nomad_knowflow.projects p on p.id = c.project_id
   where c.id = p_conversation_id and nomad_knowflow_private.can_write(c.organization_id)
     and c.deleted_at is null and p.deleted_at is null
   for update of c;
  if not found then raise exception 'conversation_not_found' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.require_feature(v_org, 'knowledge_chat');

  select * into v_claim from nomad_knowflow_private.claim_idempotency_key(
    v_org, p_idempotency_key, md5(v_conv::text || ':' || p_content), 'question', v_message_id);
  if not v_claim.is_new then
    if not exists (select 1 from nomad_knowflow.messages where id = v_claim.resource_id and conversation_id = v_conv and role = 'user') then
      raise exception 'idempotency_resource_missing' using errcode = 'KF410';
    end if;
    return jsonb_build_object('message_id', v_claim.resource_id, 'duplicate', true,
      'answer_id', (select id from nomad_knowflow.messages where reply_to = v_claim.resource_id));
  end if;

  perform nomad_knowflow_private.consume_quota_for(v_org, 'questions', 1);
  insert into nomad_knowflow.messages (id, conversation_id, role, content) values (v_message_id, v_conv, 'user', p_content);
  return jsonb_build_object('message_id', v_message_id, 'duplicate', false, 'answer_id', null);
end;
$$;

-- 답변 저장(service_role 전용: 서버가 AI 답변을 질문에 붙인다). 질문 1개당 답변 1개, 재저장은 같은 답변(duplicate).
-- 잠김과 무관(잠기기 직전 질문의 답변). 질문이 아니거나 없거나 삭제된 대화면 P0002
create function nomad_knowflow.save_answer(p_question_id uuid, p_content text, p_citation_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv uuid;
  v_answer_id uuid;
begin
  if p_content is null or char_length(p_content) = 0 or char_length(p_content) > 100000 then
    raise exception 'invalid_content' using errcode = '22023';
  end if;
  if p_citation_metadata is null or jsonb_typeof(p_citation_metadata) <> 'object' then
    raise exception 'invalid_citation_metadata' using errcode = '22023';
  end if;
  select m.conversation_id into v_conv
    from nomad_knowflow.messages m join nomad_knowflow.conversations c on c.id = m.conversation_id
   where m.id = p_question_id and m.role = 'user' and c.deleted_at is null
   for update of m;
  if not found then raise exception 'question_not_found' using errcode = 'P0002'; end if;
  insert into nomad_knowflow.messages (conversation_id, role, content, citation_metadata, reply_to)
  values (v_conv, 'assistant', p_content, p_citation_metadata, p_question_id)
  on conflict (reply_to) where reply_to is not null do nothing
  returning id into v_answer_id;
  if v_answer_id is null then
    select id into v_answer_id from nomad_knowflow.messages where reply_to = p_question_id;
    return jsonb_build_object('answer_id', v_answer_id, 'duplicate', true);
  end if;
  return jsonb_build_object('answer_id', v_answer_id, 'duplicate', false);
end;
$$;

-- 보고서: 프로젝트 잠금 → 기능(space_reports) → 멱등 키(요청 해시 = 프로젝트·제목) → monthly_reports 차감 → 보고서(generating)+생성 작업.
-- 생성 작업이 최종 실패하면 fail_job·reap_expired_jobs가 보고서를 failed로 두고 차감 표식(quota_charged_period)이 남아 있을 때만 1회 환불한다
create function nomad_knowflow.create_report(p_project_id uuid, p_title text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_org uuid;
  v_report_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_claim record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 300 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  select id, organization_id into v_project_id, v_org from nomad_knowflow.projects
   where id = p_project_id and deleted_at is null and nomad_knowflow_private.can_write(organization_id)
   for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  perform nomad_knowflow_private.require_feature(v_org, 'space_reports');

  select * into v_claim from nomad_knowflow_private.claim_idempotency_key(
    v_org, p_idempotency_key, md5(v_project_id::text || ':' || btrim(p_title)), 'report', v_report_id);
  if not v_claim.is_new then
    select r.id, j.id into v_report_id, v_job_id
      from nomad_knowflow.reports r
      left join lateral (
        select id from nomad_knowflow.processing_jobs where report_id = r.id and job_type = 'report_generate' order by created_at desc limit 1
      ) j on true
     where r.id = v_claim.resource_id and r.organization_id = v_org;
    if v_report_id is null then raise exception 'idempotency_resource_missing' using errcode = 'KF410'; end if;
    return jsonb_build_object('report_id', v_report_id, 'job_id', v_job_id, 'duplicate', true);
  end if;

  perform nomad_knowflow_private.consume_quota_for(v_org, 'reports', 1);
  insert into nomad_knowflow.reports (id, project_id, organization_id, title, quota_charged_period)
  values (v_report_id, v_project_id, v_org, btrim(p_title), nomad_knowflow_private.current_period_start());
  insert into nomad_knowflow.processing_jobs (organization_id, report_id, job_type)
  values (v_org, v_report_id, 'report_generate')
  returning id into v_job_id;
  return jsonb_build_object('report_id', v_report_id, 'job_id', v_job_id, 'duplicate', false);
end;
$$;

-- ===== EXECUTE 권한: 전부 회수 후 필요한 것만 =====
revoke execute on all functions in schema nomad_knowflow from public, anon, authenticated, service_role;
revoke execute on all functions in schema nomad_knowflow_private from public, anon, authenticated, service_role;
grant execute on function nomad_knowflow.consume_auth_rate_limit(text, text) to anon, authenticated;
grant execute on function
  nomad_knowflow.create_project(uuid, text, text), nomad_knowflow.update_project(uuid, jsonb), nomad_knowflow.delete_project(uuid),
  nomad_knowflow.register_pdf_source(uuid, text, text, text, text, text), nomad_knowflow.get_source_chunks(uuid, integer, integer, uuid),
  nomad_knowflow.delete_sources(uuid, uuid[]), nomad_knowflow.retry_source(uuid, text, text),
  nomad_knowflow.list_project_jobs(uuid, text, timestamptz, uuid, integer),
  nomad_knowflow.ask_question(uuid, text, text), nomad_knowflow.create_report(uuid, text, text)
to authenticated;
grant execute on function
  nomad_knowflow.register_youtube_source(uuid, uuid, text, text, text, integer, text, text),
  nomad_knowflow.claim_job(integer), nomad_knowflow.heartbeat_job(uuid, integer, integer),
  nomad_knowflow.progress_job(uuid, integer, text, integer), nomad_knowflow.complete_job(uuid, integer),
  nomad_knowflow.fail_job(uuid, integer, text, boolean), nomad_knowflow.replace_source_chunks(uuid, integer, jsonb),
  nomad_knowflow.replace_source_moments(uuid, integer, jsonb), nomad_knowflow.sweep_source_rechecks(integer),
  nomad_knowflow.apply_source_recheck(uuid, integer, jsonb), nomad_knowflow.save_answer(uuid, text, jsonb)
to service_role;

commit;
