-- task-004 [4/6] 가입 트리거(profiles·user_quotas 생성)와 update_profile RPC

-- 트리거 함수: auth.users INSERT 주체(supabase_auth_admin)가 실행. DEFINER라 별도 EXECUTE 부여 없음
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100), '');
begin
  insert into public.profiles (id, display_name) values (new.id, v_name)
  on conflict (id) do nothing;
  insert into public.user_quotas (user_id, plan_code, period_start)
  values (new.id, 'beta', public.current_period_start())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- update_profile: 본인 프로필만 수정(대상 id를 받지 않는다). authenticated 호출 허용
create function public.update_profile(p_display_name text) returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_name is not null and char_length(v_name) > 100 then
    raise exception 'display_name_too_long' using errcode = '22023';
  end if;
  update public.profiles set display_name = v_name where id = v_uid returning * into v_row;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.update_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.update_profile(text) to authenticated;
