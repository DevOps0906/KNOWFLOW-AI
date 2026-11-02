-- task-004 [1/6] 확장, 기본 권한 회수, 공용 헬퍼
-- 규칙 정본: docs/05_DATA_MODEL.md#7. 이 파일 이후 만들어지는 테이블·함수는 anon/authenticated에 아무 권한도 받지 않는다.

-- 한국어 키워드 검색용(ADR-0002). pgvector는 task-013에서 활성화한다.
create extension if not exists pg_trgm with schema extensions;

-- 스키마 CREATE 권한 회수(Supabase 기본은 열려 있다)
revoke create on schema public from public, anon, authenticated;

-- 이후 객체의 기본 권한: Supabase가 anon/authenticated/service_role에 자동으로 주는 ALL을 막는다.
-- 테이블·시퀀스: anon/authenticated 회수(service_role은 Worker용으로 유지, RLS 우회)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- 함수: PUBLIC 기본 EXECUTE와 Supabase 기본 부여를 모두 회수. 필요한 함수만 각 migration에서 명시 GRANT
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;

-- 이미 있는 객체도 회수(방어적)
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- 공용 헬퍼(내부용, 누구에게도 EXECUTE 부여하지 않음)
create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 쿼터 월 경계: Asia/Seoul 기준 이번 달 1일
create function public.current_period_start() returns date
language sql stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Asia/Seoul')::date;
$$;
