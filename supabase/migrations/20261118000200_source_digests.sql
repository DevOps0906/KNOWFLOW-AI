-- 자료 다이제스트(docs/digest-contract.md §2·§2-1): source_digests(자료 1:1) + service_role RPC save_source_digest.
-- 다이제스트는 자료 요약(sentences) 단계를 대체한다. 청크가 바뀌어도 행을 지우지 않는다:
--   행의 job_id가 그 자료의 최신 성공 source_ingest와 다르면 조회 API가 pending으로 보고, 현재 청크에 없는 인용은 뺀다.
-- usage_events.event_type은 제약 없는 text라 'source_digest' 사용 기록을 위해 바꿀 것이 없다. 백필은 하지 않는다(기존 자료는 status none).

-- 1) source_digests ---------------------------------------------------------------
create table public.source_digests (
  source_id uuid primary key,
  project_id uuid not null,
  user_id uuid not null,
  -- 다이제스트를 만든 source_ingest 작업(최신 성공 작업과 비교해 오래됨을 판정한다)
  job_id uuid not null,
  status text not null check (status in ('ready', 'failed')),
  -- ready면 계약 §2 형식(형식 검사는 save_source_digest), failed면 null
  digest jsonb,
  model text not null check (char_length(btrim(model)) between 1 and 200),
  created_at timestamptz not null default now(),
  check ((status = 'ready') = (digest is not null)),
  foreign key (source_id, project_id) references public.sources (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
alter table public.source_digests enable row level security;
create index source_digests_user_id_idx on public.source_digests (user_id);
create index source_digests_project_id_idx on public.source_digests (project_id);

comment on table public.source_digests is
  '자료 다이제스트(유튜브·PDF, 자료 1:1). 항목마다 그 자료의 청크 인용. 쓰기는 save_source_digest만(digest-contract §2-1)';

grant select on public.source_digests to authenticated;
-- source_summaries와 같은 조건: 소유자만, 자료가 보이고(sources RLS) 비활성이 아닐 때만. 쓰기 권한은 없다
create policy source_digests_select_own on public.source_digests for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.sources s where s.id = source_digests.source_id and s.unavailable_at is null)
  );

-- 2) save_source_digest ------------------------------------------------------------
-- 다이제스트 저장(upsert). Worker(service_role) 전용, 완료 뒤 후행 단계에서 부른다.
-- p_status 'ready'는 p_digest(계약 §2 형식)를, 'failed'는 p_digest null을 받는다(MAX_TOKENS·형식 불량 기록).
-- 저장 조건(save_source_summary와 같다): p_job_id가 그 자료의 가장 최근에 끝난 succeeded source_ingest 작업이고,
--   자료가 미삭제·비활성 아님이고, (ready면) 모든 chunk_id가 지금 그 자료의 청크일 때. 아니면 false(아무것도 바꾸지 않음).
-- 자료 행을 잠가(FOR NO KEY UPDATE) replace_source_chunks와 직렬화한다.
-- 오류 코드(SQLSTATE): 22023 형식 오류(invalid_digest)·256KB 초과·모델명 오류·유튜브/PDF 아닌 자료(unsupported_digest_source)
create function public.save_source_digest(p_job_id uuid, p_status text, p_digest jsonb, p_model text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_source public.sources;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_model is null or char_length(btrim(p_model)) not between 1 and 200 then
    raise exception 'invalid_digest' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('ready', 'failed') then
    raise exception 'invalid_digest' using errcode = '22023';
  end if;
  if p_status = 'failed' and p_digest is not null then
    raise exception 'invalid_digest' using errcode = '22023';
  end if;

  if p_status = 'ready' then
    if p_digest is null or jsonb_typeof(p_digest) <> 'object' or octet_length(p_digest::text) > 262144 then
      raise exception 'invalid_digest' using errcode = '22023';
    end if;
    -- 최상위: version 1, title 1~120자, glance 2~5·terms 0~6·chapters 1~6 배열
    -- (키가 없으면 jsonb_typeof가 NULL이라 coalesce로 거부한다. 길이 검사는 배열일 때만 한다 — OR는 평가 순서를 보장하지 않는다)
    if p_digest -> 'version' is distinct from '1'::jsonb
       or coalesce(jsonb_typeof(p_digest -> 'title'), '') <> 'string'
       or char_length(btrim(p_digest ->> 'title')) not between 1 and 120
       or (case when jsonb_typeof(p_digest -> 'glance') = 'array' then jsonb_array_length(p_digest -> 'glance') not between 2 and 5 else true end)
       or (case when jsonb_typeof(p_digest -> 'terms') = 'array' then jsonb_array_length(p_digest -> 'terms') > 6 else true end)
       or (case when jsonb_typeof(p_digest -> 'chapters') = 'array' then jsonb_array_length(p_digest -> 'chapters') not between 1 and 6 else true end)
    then
      raise exception 'invalid_digest' using errcode = '22023';
    end if;

    -- 항목 형식: 글자 수와 하위 배열 개수
    if exists (
      select 1 from jsonb_array_elements(p_digest -> 'glance') g
       where jsonb_typeof(g) <> 'object'
          or coalesce(jsonb_typeof(g -> 'text'), '') <> 'string'
          or char_length(btrim(g ->> 'text')) not between 1 and 300
          or case when jsonb_typeof(g -> 'details') = 'array'
                  then jsonb_array_length(g -> 'details') > 3
                    or exists (select 1 from jsonb_array_elements(g -> 'details') d
                                where jsonb_typeof(d) <> 'string' or char_length(btrim(d #>> '{}')) not between 1 and 200)
                  else true end
    ) or exists (
      select 1 from jsonb_array_elements(p_digest -> 'terms') t
       where jsonb_typeof(t) <> 'object'
          or coalesce(jsonb_typeof(t -> 'term'), '') <> 'string'
          or char_length(btrim(t ->> 'term')) not between 1 and 40
          or coalesce(jsonb_typeof(t -> 'desc'), '') <> 'string'
          or char_length(btrim(t ->> 'desc')) not between 1 and 200
    ) or exists (
      select 1 from jsonb_array_elements(p_digest -> 'chapters') c
       where jsonb_typeof(c) <> 'object'
          or coalesce(jsonb_typeof(c -> 'title'), '') <> 'string'
          or char_length(btrim(c ->> 'title')) not between 1 and 120
          or coalesce(jsonb_typeof(c -> 'intro'), '') <> 'string'
          or char_length(c ->> 'intro') > 400
          or case when jsonb_typeof(c -> 'points') = 'array'
                  then jsonb_array_length(c -> 'points') not between 1 and 4
                    or exists (
                      select 1 from jsonb_array_elements(c -> 'points') p
                       where jsonb_typeof(p) <> 'object'
                          or coalesce(jsonb_typeof(p -> 'text'), '') <> 'string'
                          or char_length(btrim(p ->> 'text')) not between 1 and 300
                          or case when jsonb_typeof(p -> 'subpoints') = 'array'
                                  then jsonb_array_length(p -> 'subpoints') > 3
                                    or exists (
                                      select 1 from jsonb_array_elements(p -> 'subpoints') s
                                       where jsonb_typeof(s) <> 'object'
                                          or coalesce(jsonb_typeof(s -> 'text'), '') <> 'string'
                                          or char_length(btrim(s ->> 'text')) not between 1 and 300
                                    )
                                  else true end
                    )
                  else true end
    ) then
      raise exception 'invalid_digest' using errcode = '22023';
    end if;

    -- 인용: 모든 항목(glance·terms·chapters·points·subpoints)이 소문자 UUID 1~20개 배열을 가진다
    if exists (
      select 1
        from (
          select g as item from jsonb_array_elements(p_digest -> 'glance') g
          union all select t from jsonb_array_elements(p_digest -> 'terms') t
          union all select c from jsonb_array_elements(p_digest -> 'chapters') c
          union all select p from jsonb_array_elements(p_digest -> 'chapters') c, jsonb_array_elements(c -> 'points') p
          union all select s from jsonb_array_elements(p_digest -> 'chapters') c, jsonb_array_elements(c -> 'points') p,
                                  jsonb_array_elements(p -> 'subpoints') s
        ) i
       where coalesce(jsonb_typeof(i.item -> 'chunk_ids'), '') <> 'array'
          or case when jsonb_typeof(i.item -> 'chunk_ids') = 'array'
                  then jsonb_array_length(i.item -> 'chunk_ids') not between 1 and 20
                    or exists (select 1 from jsonb_array_elements(i.item -> 'chunk_ids') x
                                where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ v_uuid)
                  else true end
    ) then
      raise exception 'invalid_digest' using errcode = '22023';
    end if;
  end if;

  select * into v_job from public.processing_jobs
   where id = p_job_id and job_type = 'source_ingest' and status = 'succeeded';
  if not found then
    return false;
  end if;

  select * into v_source from public.sources
   where id = v_job.source_id and deleted_at is null and unavailable_at is null
   for no key update;
  if not found then
    return false;
  end if;
  if v_source.source_type not in ('youtube', 'pdf') then
    raise exception 'unsupported_digest_source' using errcode = '22023';
  end if;

  -- 더 늦게 끝난 succeeded source_ingest 작업이 있으면 낡은 작업이다
  if exists (
    select 1 from public.processing_jobs j
     where j.source_id = v_source.id and j.job_type = 'source_ingest' and j.status = 'succeeded' and j.id <> v_job.id
       and (j.finished_at, j.id) > (v_job.finished_at, v_job.id)
  ) then
    return false;
  end if;

  -- 모든 인용이 지금 그 자료의 청크여야 한다(형식 검사를 통과했으므로 chunk_ids 값은 UUID 문자열이다)
  if p_status = 'ready' and exists (
    select 1 from jsonb_path_query(p_digest, 'lax $.**.chunk_ids[*]') x
     where not exists (select 1 from public.source_chunks sc where sc.id = (x #>> '{}')::uuid and sc.source_id = v_source.id)
  ) then
    return false;
  end if;

  insert into public.source_digests (source_id, project_id, user_id, job_id, status, digest, model)
  values (v_source.id, v_source.project_id, v_source.user_id, v_job.id, p_status, p_digest, btrim(p_model))
  on conflict (source_id) do update
     set job_id = excluded.job_id, status = excluded.status, digest = excluded.digest, model = excluded.model, created_at = now();
  return true;
end;
$$;

comment on function public.save_source_digest(uuid, text, jsonb, text) is
  '자료 다이제스트(ready·failed)를 최신 완료 작업·현재 청크 기준으로 저장한다. Worker 전용(digest-contract §2-1)';

revoke all on function public.save_source_digest(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_source_digest(uuid, text, jsonb, text) to service_role;
