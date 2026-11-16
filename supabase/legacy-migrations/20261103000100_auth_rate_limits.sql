-- task-005: 인증 앱 한도(고정 윈도 카운터). 상태는 Postgres에 저장한다(메모리 금지).
-- 키는 호출자(웹 서버)가 HMAC으로 비식별화한 값만 받는다(원본 IP·이메일은 저장하지 않는다).
-- 한도 값은 함수 안에 고정한다(호출자가 한도를 바꿀 수 없음).

create table public.auth_rate_limits (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (scope, key_hash, window_start)
);
comment on table public.auth_rate_limits is '인증 요청 한도 카운터(고정 윈도). 비식별 키만 저장, 하루 지난 행은 기회가 될 때 정리';
create index auth_rate_limits_window_idx on public.auth_rate_limits (window_start);

alter table public.auth_rate_limits enable row level security;
-- 명시적 전부 거부 정책 + 권한 회수: 어떤 역할도 테이블을 직접 읽거나 쓰지 못한다(DEFINER 함수만 접근).
create policy auth_rate_limits_deny_all on public.auth_rate_limits for all to anon, authenticated using (false) with check (false);
revoke all on public.auth_rate_limits from public, anon, authenticated, service_role;

-- 반환: allowed(허용 여부), retry_after(거부 시 다음 윈도까지 남은 초, 허용이면 0)
create function public.consume_auth_rate_limit(p_scope text, p_key_hash text)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window integer;
  v_start timestamptz;
  v_hits integer;
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

  insert into public.auth_rate_limits as r (scope, key_hash, window_start, hits)
  values (p_scope, p_key_hash, v_start, 1)
  on conflict (scope, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- 오래된 행 정리(요청의 약 1%에서만, 인덱스 범위 삭제)
  if random() < 0.01 then
    delete from public.auth_rate_limits where window_start < now() - interval '1 day';
  end if;

  if v_hits > v_limit then
    return query select false, greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - now())))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, text) from public, anon, authenticated, service_role;
-- 로그인 전 요청도 한도를 적용해야 하므로 anon에게 부여한다(웹 서버가 anon 키로 호출).
grant execute on function public.consume_auth_rate_limit(text, text) to anon, authenticated;
