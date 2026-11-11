import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChunkPage, ChunksResult, DeleteResult, LatestJobRow, ProjectRow, SourceReadBackend, SourceRow } from "./handlers";

// 읽기는 로그인 사용자의 세션으로 RLS를 통해서만 한다(본인·삭제되지 않은 프로젝트·자료만 보인다).
// deleted_at 조건은 RLS와 같은 뜻을 한 번 더 적은 것이다. 청크·삭제는 RPC만 쓰고 user_id는 넘기지 않는다.

const SOURCE_COLUMNS =
  "id, project_id, source_type, title, status, error_code, unavailable_at, original_url, video_id, channel_title, duration_seconds, created_at, updated_at";

interface RpcError {
  code?: string;
}

function chunksError(error: RpcError): Exclude<ChunksResult, { ok: true }> {
  switch (error.code) {
    case "28000":
      return { ok: false, kind: "unauthorized" };
    case "P0002":
      return { ok: false, kind: "not_found" };
    case "KF409":
      return { ok: false, kind: "not_ready" };
    case "22023":
      return { ok: false, kind: "invalid" };
    default:
      return { ok: false, kind: "unknown" };
  }
}

function deleteError(error: RpcError): Exclude<DeleteResult, { ok: true }> {
  switch (error.code) {
    case "28000":
      return { ok: false, kind: "unauthorized" };
    case "P0002":
      return { ok: false, kind: "not_found" };
    case "22023":
      return { ok: false, kind: "invalid" };
    default:
      return { ok: false, kind: "unknown" };
  }
}

export function createSupabaseSourceReadBackend(supabase: SupabaseClient): SourceReadBackend {
  return {
    async getUserId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },

    async getProjectDetail(projectId) {
      const [project, sources] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, description, archived_at, summary, suggested_questions, created_at, updated_at")
          .eq("id", projectId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("sources")
          .select(`${SOURCE_COLUMNS}, processing_jobs(id, status, retryable, created_at)`)
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          // 자료별 최신 처리 작업 1건(재시도 버튼 판단). 재확인(source_recheck) 작업은 섞지 않는다(임베드만 거르고 자료는 그대로)
          .eq("processing_jobs.job_type", "source_ingest")
          .order("created_at", { referencedTable: "processing_jobs", ascending: false })
          .limit(1, { referencedTable: "processing_jobs" }),
      ]);
      if (project.error || sources.error) throw new Error("project_detail_failed");
      if (!project.data) return null;
      const rows = (sources.data ?? []) as unknown as Array<SourceRow & { processing_jobs?: LatestJobRow[] | null }>;
      return {
        project: project.data as ProjectRow,
        sources: rows.map(({ processing_jobs, ...row }) => ({ ...row, latest_job: processing_jobs?.[0] ?? null })),
      };
    },

    async getSource(sourceId) {
      const { data, error } = await supabase.from("sources").select(SOURCE_COLUMNS).eq("id", sourceId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error("source_read_failed");
      return (data as SourceRow | null) ?? null;
    },

    async getChunks({ sourceId, afterIndex, limit, aroundChunkId }) {
      const { data, error } = await supabase.rpc("get_source_chunks", {
        p_source_id: sourceId,
        p_after_index: afterIndex,
        p_limit: limit,
        p_around_chunk_id: aroundChunkId,
      });
      if (error) return chunksError(error);
      return { ok: true, page: data as ChunkPage };
    },

    async deleteSources(projectId, sourceIds) {
      const { data, error } = await supabase.rpc("delete_sources", { p_project_id: projectId, p_source_ids: sourceIds });
      if (error) return deleteError(error);
      return { ok: true, deleted: Number(data) };
    },
  };
}
