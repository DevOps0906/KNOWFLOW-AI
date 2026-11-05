import { sourceHandlersForRequest } from "@/lib/storage/server";

// A-04 POST: step=upload_url(서명 업로드 URL 발급) · step=register(업로드 후 등록). 파일 본문은 이 서버를 지나지 않는다.
// DELETE(자료 삭제)는 task-012 범위에서 추가한다.
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (await sourceHandlersForRequest()).post(request, projectId);
}
