import { jobHandlersForRequest } from "@/lib/jobs/server";

// A-05 POST: 실패한 자료를 새 작업으로 다시 처리한다(Idempotency-Key 헤더 필수, 202 + 작업 id).
export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  return (await jobHandlersForRequest()).retry(request, sourceId);
}
