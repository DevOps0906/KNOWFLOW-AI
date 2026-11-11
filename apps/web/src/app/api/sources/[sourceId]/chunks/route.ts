import { sourceReadHandlersForRequest } from "@/lib/sources/server";

// A-07 GET: 원문 청크(?cursor=·limit=·chunk_id=). 미완료 자료는 409, 비활성 자료는 청크 없이 unavailable=true.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  return (await sourceReadHandlersForRequest()).chunks(request, sourceId);
}
