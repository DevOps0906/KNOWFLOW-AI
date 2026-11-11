import type { SupabaseClient } from "@supabase/supabase-js";

// S-06 대시보드: 처리 중(queued·processing) 자료를 RLS로 한 번에 읽는다(프로젝트별 A-05 N회 호출 안 함).
// RLS가 본인·삭제되지 않은 프로젝트·자료만 보여 준다. deleted_at 조건은 같은 뜻을 한 번 더 적은 것이다.

export const PROCESSING_LIMIT = 10;

export interface ProcessingSourceItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  sourceType: string;
  status: "queued" | "processing";
  createdAt: string;
}

interface Row {
  id: string;
  project_id: string;
  title: string;
  source_type: string;
  status: "queued" | "processing";
  created_at: string;
  projects: { name: string } | Array<{ name: string }> | null;
}

export async function listProcessingSources(supabase: SupabaseClient, limit = PROCESSING_LIMIT): Promise<ProcessingSourceItem[]> {
  const { data, error } = await supabase
    .from("sources")
    .select("id, project_id, title, source_type, status, created_at, projects(name)")
    .in("status", ["queued", "processing"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error("processing_sources_failed");
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: project?.name ?? "",
      title: row.title,
      sourceType: row.source_type,
      status: row.status,
      createdAt: row.created_at,
    };
  });
}
