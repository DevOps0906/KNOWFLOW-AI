// A-03 GET 응답 형태(정본: lib/sources/handlers.ts projectDetail). 화면은 error_code를 쓰지 않고 error_message만 보여 준다.

export type SourceStatus = "queued" | "processing" | "completed" | "failed";

export interface WorkspaceSource {
  id: string;
  project_id: string;
  source_type: string;
  title: string;
  status: SourceStatus | string;
  error_code: string | null;
  error_message: string | null;
  unavailable_at: string | null;
  original_url: string | null;
  video_id: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  latest_job: { id: string; status: string; retryable: boolean } | null;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  summary: string | null;
  suggested_questions: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  project: WorkspaceProject;
  sources: WorkspaceSource[];
}

export const isInProgress = (status: string) => status === "queued" || status === "processing";
