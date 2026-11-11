import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { classifyListError, classifyRetryError, createJobHandlers, type JobRow, type JobsBackend } from "./handlers";

// 서버 전용: 요청 쿠키에 묶인 Supabase 클라이언트(anon 키 + 사용자 세션)로 RPC를 부른다. user_id는 넘기지 않는다.
export function createSupabaseJobsBackend(supabase: SupabaseClient): JobsBackend {
  return {
    async getUserId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    async list({ projectId, status, cursor, limit }) {
      const { data, error } = await supabase.rpc("list_project_jobs", {
        p_project_id: projectId,
        p_status: status,
        p_cursor_created_at: cursor?.createdAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: limit,
      });
      if (error) return { ok: false, kind: classifyListError(error) };
      return { ok: true, rows: (data ?? []) as JobRow[] };
    },
    async retry({ sourceId, idempotencyKey, requestHash }) {
      const { data, error } = await supabase.rpc("retry_source", {
        p_source_id: sourceId,
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
      });
      if (error) return classifyRetryError(error);
      const row = data as { job_id: string; duplicate: boolean };
      return { ok: true, jobId: row.job_id, duplicate: row.duplicate };
    },
  };
}

export async function jobHandlersForRequest() {
  const supabase = await createSupabaseServerClient();
  return createJobHandlers({ backend: createSupabaseJobsBackend(supabase), siteUrl: process.env.NEXT_PUBLIC_SITE_URL });
}
