import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { captureStoreFromEnv, isCaptureEnabled } from "@/server/captures/service";
import { createSessionCapturesBackend } from "./backend";
import { createCapturesHandlers } from "./handler";

// A-11 GET: 캡처 목록(서명 URL·시각·채널명·원본 링크) / POST: 캡처 저장(본문 = 이미지 바이트, ?t=초&moment_id=, Idempotency-Key 헤더).
// 스위치 CAPTURE_ENABLED가 꺼지면 모든 호출 422.
async function handlers() {
  const supabase = await createSupabaseServerClient();
  return createCapturesHandlers({
    enabled: () => isCaptureEnabled(),
    backend: createSessionCapturesBackend(supabase),
    store: captureStoreFromEnv,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  return (await handlers()).list(request, sourceId);
}

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  return (await handlers()).create(request, sourceId);
}
