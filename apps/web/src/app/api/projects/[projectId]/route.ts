import { projectHandlersForRequest } from "@/lib/projects/server";

// A-03의 PATCH·DELETE만 여기서 다룬다. GET(상세)은 task-012 소유.
type Context = { params: Promise<{ projectId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { projectId } = await params;
  return (await projectHandlersForRequest()).update(request, projectId);
}

export async function DELETE(request: Request, { params }: Context) {
  const { projectId } = await params;
  return (await projectHandlersForRequest()).remove(request, projectId);
}
