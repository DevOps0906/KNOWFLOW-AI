-- task-012a: 원문 청크 조회(A-07)와 자료 소프트 삭제(A-04 DELETE) RPC.
-- 오류 코드(SQLSTATE):
--   get_source_chunks: 28000 미인증 · P0002 자료 없음(타인·삭제된 자료·삭제된 프로젝트도 동일) · KF409 아직 completed 아님 · 22023 잘못된 입력
--   delete_sources: 28000 미인증 · P0002 프로젝트 또는 자료 하나라도 없음(타인 것 포함, 전체 거부) · 22023 잘못된 입력

-- get_source_chunks: source_chunks는 사용자 직접 접근이 없으므로 DEFINER로 읽고, 소유·미삭제는 함수 안에서 auth.uid()로 확인한다.
-- 순서: 소유 확인 → 비활성(unavailable_at)이면 청크 0건(메타만) → 미완료면 KF409 → chunk_index keyset 페이지.
-- p_around_chunk_id가 같은 자료의 청크면 그 청크 앞 절반 + 그 청크부터의 창을 돌려준다. 못 찾으면(재처리로 id가 바뀜) 처음부터 + around='not_found'.
-- 반환: {"chunks":[{id,chunk_index,content,locator}], "has_more", "has_before", "around": "found"|"not_found"|null, "unavailable"}
create function public.get_source_chunks(
  p_source_id uuid,
  p_after_index integer default null,
  p_limit integer default 50,
  p_around_chunk_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_unavailable timestamptz;
  v_around text;
  v_target integer;
  v_start integer;
  v_chunks jsonb;
  v_count integer;
  v_first integer;
  v_last integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or (p_after_index is not null and p_after_index < 0)
     or (p_after_index is not null and p_around_chunk_id is not null) then
    raise exception 'invalid_chunks_input' using errcode = '22023';
  end if;

  select s.status, s.unavailable_at into v_status, v_unavailable
    from public.sources s
    join public.projects p on p.id = s.project_id
   where s.id = p_source_id and s.user_id = v_uid and s.deleted_at is null
     and p.user_id = v_uid and p.deleted_at is null;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  if v_unavailable is not null then
    return jsonb_build_object('chunks', '[]'::jsonb, 'has_more', false, 'has_before', false, 'around', null, 'unavailable', true);
  end if;
  if v_status <> 'completed' then
    raise exception 'source_not_ready' using errcode = 'KF409';
  end if;

  if p_around_chunk_id is not null then
    select chunk_index into v_target from public.source_chunks
     where id = p_around_chunk_id and source_id = p_source_id;
    if found then
      v_around := 'found';
      -- 대상 앞쪽 절반(chunk_index에 빈 번호가 있어도 실제 행 기준)
      select coalesce(min(b.chunk_index), v_target) into v_start
        from (select chunk_index from public.source_chunks
               where source_id = p_source_id and chunk_index < v_target
               order by chunk_index desc limit p_limit / 2) b;
    else
      v_around := 'not_found';
    end if;
  end if;

  -- limit + 1개를 읽어 다음 쪽 여부를 안다
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'chunk_index', c.chunk_index, 'content', c.content, 'locator', c.locator)
                            order by c.chunk_index) filter (where c.rn <= p_limit), '[]'::jsonb),
         count(*), min(c.chunk_index), max(c.chunk_index) filter (where c.rn <= p_limit)
    into v_chunks, v_count, v_first, v_last
    from (select sc.id, sc.chunk_index, sc.content, sc.locator, row_number() over (order by sc.chunk_index) as rn
            from public.source_chunks sc
           where sc.source_id = p_source_id
             and (p_after_index is null or sc.chunk_index > p_after_index)
             and (v_start is null or sc.chunk_index >= v_start)
           order by sc.chunk_index
           limit p_limit + 1) c;

  return jsonb_build_object(
    'chunks', v_chunks,
    'has_more', v_count > p_limit,
    'has_before', v_first is not null and exists (
      select 1 from public.source_chunks where source_id = p_source_id and chunk_index < v_first),
    'around', v_around,
    'unavailable', false
  );
end;
$$;

comment on function public.get_source_chunks(uuid, integer, integer, uuid) is
  '본인·미삭제·completed 자료의 원문 청크를 chunk_index keyset으로 읽는다(A-07, 페이지 상한 100)';

-- delete_sources: 소프트 삭제(deleted_at). 하나라도 타인·없는 id면 전체 거부(P0002, 정보 노출 없음), 본인이 이미 지운 id는 성공(멱등).
-- 진행 중 작업이 있어도 지운다. Worker가 source_deleted 영구 실패로 닫고(fail_job 환불 경로), 청크 쓰기는 replace_source_chunks가 거부한다.
-- 청크·Storage 객체는 남긴다(영구 삭제는 task-019). 반환: 이번에 새로 지운 자료 수.
create function public.delete_sources(p_project_id uuid, p_source_ids uuid[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_owned integer;
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) not between 1 and 100 or array_position(p_source_ids, null) is not null then
    raise exception 'invalid_source_ids' using errcode = '22023';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_source_ids) x;

  perform 1 from public.projects
   where id = p_project_id and user_id = v_uid and deleted_at is null
   for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  -- 이미 지운 본인 자료도 센다(멱등)
  select count(*) into v_owned from (
    select 1 from public.sources
     where id = any (v_ids) and project_id = p_project_id and user_id = v_uid
     for update
  ) s;
  if v_owned <> cardinality(v_ids) then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  update public.sources set deleted_at = now()
   where id = any (v_ids) and deleted_at is null;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.delete_sources(uuid, uuid[]) is
  '프로젝트의 자료 여러 건을 소프트 삭제한다(A-04 DELETE). 전체 성공 또는 전체 거부, 이미 삭제된 본인 자료는 멱등';

revoke all on function public.get_source_chunks(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_sources(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_source_chunks(uuid, integer, integer, uuid) to authenticated;
grant execute on function public.delete_sources(uuid, uuid[]) to authenticated;
