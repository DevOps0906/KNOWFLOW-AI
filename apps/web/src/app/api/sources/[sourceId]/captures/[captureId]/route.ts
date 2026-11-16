import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { captureStoreFromEnv, isCaptureEnabled } from "@/server/captures/service";
import { createSessionCapturesBackend } from "../backend";
import { createCapturesHandlers } from "../handler";

// A-11 DELETE: 본인 캡처 삭제(행 삭제 + 삭제 대기열 → purgeCaptures). 204. 스위치가 꺼지면 422.
export async function DELETE(request: Request, { params }: { params: Promise<{ sourceId: string; captureId: string }> }) {
  const { sourceId, captureId } = await params;
  const supabase = await createSupabaseServerClient();
  return createCapturesHandlers({
    enabled: () => isCaptureEnabled(),
    backend: createSessionCapturesBackend(supabase),
    store: captureStoreFromEnv,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  }).remove(request, sourceId, captureId);
}
