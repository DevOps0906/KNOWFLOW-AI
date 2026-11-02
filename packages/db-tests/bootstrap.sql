-- 테스트 전용 Supabase 호환 준비 (ADR-0005). 운영 마이그레이션(supabase/migrations)에는 들어가지 않는다.
-- 빈 Postgres에서 마이그레이션 적용 "전에" 실행한다. 테스트 연결 사용자는 superuser(postgres)이며,
-- 검사는 SET LOCAL ROLE + JWT 클레임으로만 한다.
--
-- 재현하는 Supabase 기본값:
--  1. 역할 anon·authenticated(NOLOGIN), service_role(BYPASSRLS), supabase_auth_admin
--  2. 스키마 extensions·auth·storage + 역할별 USAGE
--  3. public 스키마 기본 권한: 테이블·시퀀스·함수 ALL을 anon/authenticated/service_role에 자동 부여
--  4. 함수 PUBLIC EXECUTE(PG 기본), public 스키마 CREATE 부여
--  5. auth.users(소유자 supabase_auth_admin), auth.uid()/auth.role()(요청 JWT 클레임에서 읽음)
--  6. storage 최소 스키마(buckets·objects·foldername), objects RLS 활성 + 역할에 ALL(정책이 게이트)
-- 재현하지 못하는 것: supabase_admin 소유 기본 권한, PostgREST/Auth/Storage 서비스 자체 → docs/security/supabase-verify.md

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
-- 마이그레이션이 supabase_auth_admin 소유 테이블에 트리거를 만들 수 있어야 한다(Supabase에서도 postgres가 가능)
grant usage, create on schema auth to supabase_auth_admin;

-- public 스키마 기본 권한 (Supabase 기본: ALL)
grant usage, create on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table auth.users owner to supabase_auth_admin;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- storage (최소)
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
