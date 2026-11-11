import { jobHandlersForRequest } from "@/lib/jobs/server";

// A-05 GET: 프로젝트의 작업 목록(상태 필터, 복합 커서). 재시도는 /api/sources/[sourceId]/retry.
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (await jobHandlersForRequest()).list(request, projectId);
}
