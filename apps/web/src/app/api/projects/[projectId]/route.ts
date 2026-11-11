import { projectHandlersForRequest } from "@/lib/projects/server";
import { sourceReadHandlersForRequest } from "@/lib/sources/server";

// A-03: GET(프로젝트 + 자료 목록 + 요약·추천 질문, task-012) · PATCH · DELETE.
type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { projectId } = await params;
  return (await sourceReadHandlersForRequest()).projectDetail(request, projectId);
}

export async function PATCH(request: Request, { params }: Context) {
  const { projectId } = await params;
  return (await projectHandlersForRequest()).update(request, projectId);
}

export async function DELETE(request: Request, { params }: Context) {
  const { projectId } = await params;
  return (await projectHandlersForRequest()).remove(request, projectId);
}
