-- task-004 [3/6] RLS 정책과 SELECT 권한
-- 사용자 롤(authenticated)은 SELECT만. INSERT/UPDATE/DELETE는 권한 자체가 없고 쓰기는 SECURITY DEFINER RPC로만.
-- anon은 어떤 테이블에도 권한이 없다. service_role은 BYPASSRLS(Worker 전용, 서비스 키는 브라우저·로그 노출 금지).
-- 소프트 삭제: 부모 프로젝트가 보이지 않으면(deleted_at) 하위 행도 보이지 않는다. 하위 정책의 exists 서브쿼리에는 부모의 RLS가 적용된다.

-- 직접 조회 가능한 테이블만 SELECT 부여 (source_chunks·idempotency_keys 제외)
grant select on
  public.plans, public.profiles, public.user_quotas, public.projects, public.sources,
  public.conversations, public.messages, public.reports, public.report_citations,
  public.processing_jobs, public.usage_events
to authenticated;

create policy plans_select on public.plans for select to authenticated using (true); -- 시드 데이터, 읽기 전용

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy user_quotas_select_own on public.user_quotas for select to authenticated
  using (user_id = (select auth.uid()));

create policy projects_select_own on public.projects for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

create policy sources_select_own on public.sources for select to authenticated
  using (
    user_id = (select auth.uid()) and deleted_at is null
    and exists (select 1 from public.projects p where p.id = sources.project_id)
  );

create policy conversations_select_own on public.conversations for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = conversations.project_id)
  );

create policy messages_select_own on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id));

create policy reports_select_own on public.reports for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = reports.project_id)
  );

create policy report_citations_select_own on public.report_citations for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_citations.report_id));

create policy processing_jobs_select_own on public.processing_jobs for select to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (source_id is not null and exists (select 1 from public.sources s where s.id = processing_jobs.source_id))
      or (report_id is not null and exists (select 1 from public.reports r where r.id = processing_jobs.report_id))
    )
  );

create policy usage_events_select_own on public.usage_events for select to authenticated
  using (user_id = (select auth.uid()));

-- 직접 접근 없음: 명시적 거부 정책(권한도 부여하지 않으므로 이중 차단). 서버·RPC·검색 함수만 접근
create policy source_chunks_deny_all on public.source_chunks for all to anon, authenticated
  using (false) with check (false);
create policy idempotency_keys_deny_all on public.idempotency_keys for all to anon, authenticated
  using (false) with check (false);
