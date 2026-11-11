import { sourceReadHandlersForRequest } from "@/lib/sources/server";

// A-07 GET: 자료 메타(유형·상태·오류 문구·unavailable_at·유튜브 정보). 타인·없는·삭제된 자료는 404.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  return (await sourceReadHandlersForRequest()).source(request, sourceId);
}
