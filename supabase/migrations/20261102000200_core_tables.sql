-- task-004 [2/6] 13개 테이블 + idempotency_keys, 제약, 인덱스, RLS 활성화
-- 정책·권한은 다음 파일. 여기서는 RLS를 켜는 것까지(정책이 없으면 모든 접근 거부).

-- plans: 요금제 한도(시드). MVP는 beta 1종
create table public.plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  max_projects integer not null check (max_projects > 0),
  max_sources_per_project integer not null check (max_sources_per_project > 0),
  monthly_questions integer not null check (monthly_questions > 0),
  monthly_reports integer not null check (monthly_reports > 0),
  monthly_source_jobs integer not null check (monthly_source_jobs > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;

-- PRD 8-1 베타 초기값
insert into public.plans (code, max_projects, max_sources_per_project, monthly_questions, monthly_reports, monthly_source_jobs)
values ('beta', 20, 50, 300, 30, 100);

-- profiles: 앱 프로필. id = auth.users.id. 생성은 가입 트리거(4번 파일)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- user_quotas: 월 사용 누적. 갱신은 RPC만. 프로젝트·자료 수는 카운터 없이 생성 RPC가 부모 행을 잠그고 센다
create table public.user_quotas (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_code text not null default 'beta' references public.plans (code),
  period_start date not null,
  used_questions integer not null default 0 check (used_questions >= 0),
  used_reports integer not null default 0 check (used_reports >= 0),
  used_source_jobs integer not null default 0 check (used_source_jobs >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_quotas enable row level security;
create index user_quotas_plan_code_idx on public.user_quotas (plan_code);

-- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  archived_at timestamptz,
  deleted_at timestamptz,
  summary text,
  suggested_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_questions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id) -- 자식 테이블의 (project_id, user_id) 복합 FK용: 소유자 불일치 행 방지
);
alter table public.projects enable row level security;
create index projects_user_id_idx on public.projects (user_id) where deleted_at is null;

-- sources
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  source_type text not null check (source_type in ('pdf', 'url')), -- 새 매체는 마이그레이션으로 값 추가(05#3)
  title text not null check (char_length(btrim(title)) between 1 and 300),
  original_url text check (original_url is null or (original_url ~* '^https?://' and char_length(original_url) <= 2048)),
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  error_code text,
  error_message_safe text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  check (
    (source_type = 'pdf' and storage_path is not null)
    or (source_type = 'url' and original_url is not null)
  ),
  unique (id, project_id)
);
alter table public.sources enable row level security;
create index sources_user_id_idx on public.sources (user_id);
create index sources_project_id_idx on public.sources (project_id);
-- (project_id, content_hash) 유니크. 소프트 삭제된 자료는 제외해 같은 파일을 다시 올릴 수 있게 한다
create unique index sources_project_content_hash_key on public.sources (project_id, content_hash)
  where content_hash is not null and deleted_at is null;

-- source_chunks: 사용자 직접 접근 없음. 서버·검색 함수만. embedding 컬럼은 task-013
create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  locator jsonb not null default '{}'::jsonb check (jsonb_typeof(locator) = 'object'),
  embedding_model text,
  content_tsv tsvector generated always as (to_tsvector('simple'::regconfig, content)) stored,
  created_at timestamptz not null default now(),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  unique (source_id, chunk_index)
);
alter table public.source_chunks enable row level security;
create index source_chunks_project_id_idx on public.source_chunks (project_id);
create index source_chunks_content_trgm_idx on public.source_chunks using gin (content extensions.gin_trgm_ops);
create index source_chunks_content_tsv_idx on public.source_chunks using gin (content_tsv);

-- conversations / messages
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  title text check (title is null or char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
alter table public.conversations enable row level security;
create index conversations_user_id_idx on public.conversations (user_id);
create index conversations_project_id_idx on public.conversations (project_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citation_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(citation_metadata) = 'object'),
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_conversation_id_idx on public.messages (conversation_id, created_at);

-- reports / report_citations
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  content text not null default '',
  format text not null default 'markdown' check (format = 'markdown'),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
alter table public.reports enable row level security;
create index reports_user_id_idx on public.reports (user_id);
create index reports_project_id_idx on public.reports (project_id);

create table public.report_citations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  chunk_id uuid references public.source_chunks (id) on delete set null, -- null = 원문 삭제됨
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);
alter table public.report_citations enable row level security;
create index report_citations_report_id_idx on public.report_citations (report_id, position);
create index report_citations_chunk_id_idx on public.report_citations (chunk_id);

-- processing_jobs: 작업 큐(테이블 폴링, ADR-0005). 상태값은 JOBS.md
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_id uuid references public.sources (id) on delete cascade,
  report_id uuid references public.reports (id) on delete cascade,
  job_type text not null check (job_type in ('source_ingest', 'report_generate')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  current_step text,
  progress integer not null default 0 check (progress between 0 and 100),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  locked_until timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempt_count <= max_attempts),
  check (status <> 'succeeded' or progress = 100),
  check (
    (job_type = 'source_ingest' and source_id is not null)
    or (job_type = 'report_generate' and report_id is not null)
  )
);
alter table public.processing_jobs enable row level security;
create index processing_jobs_user_id_idx on public.processing_jobs (user_id);
create index processing_jobs_source_id_idx on public.processing_jobs (source_id);
create index processing_jobs_report_id_idx on public.processing_jobs (report_id);
-- 폴링: queued 또는 임대가 만료된 running
create index processing_jobs_poll_idx on public.processing_jobs (status, locked_until) where status in ('queued', 'running');
-- 같은 자료·리포트에 진행 중 작업은 1개
create unique index processing_jobs_one_active_per_source on public.processing_jobs (source_id)
  where source_id is not null and status in ('queued', 'running');
create unique index processing_jobs_one_active_per_report on public.processing_jobs (report_id)
  where report_id is not null and status in ('queued', 'running');

-- usage_events: 계정 삭제 시 user_id 익명화(null) 후 보관(PRD 8-1)
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  event_type text not null,
  provider text,
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost bigint check (estimated_cost is null or estimated_cost >= 0), -- 원 단위 정수, 공급자 값이 불완전하면 null
  created_at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create index usage_events_user_id_idx on public.usage_events (user_id, created_at desc);
create index usage_events_project_id_idx on public.usage_events (project_id);

-- idempotency_keys: RPC 안에서만 접근
create table public.idempotency_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  request_hash text not null check (char_length(request_hash) between 1 and 128),
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.idempotency_keys enable row level security;

-- updated_at 자동 갱신
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger user_quotas_touch before update on public.user_quotas for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger sources_touch before update on public.sources for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create trigger reports_touch before update on public.reports for each row execute function public.touch_updated_at();
create trigger processing_jobs_touch before update on public.processing_jobs for each row execute function public.touch_updated_at();
