import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isCaptureEnabled } from "@/server/youtube/capture";
import { createSupabaseCapturesBackend } from "@/lib/storage/captures";
import { createCapturesHandlers } from "./handler";

// A-11 GET·POST: L1 사용자 승인 탭 캡처(task-030). 캡처 플래그가 꺼지면 422 "지원 예정". 모든 호출은 RLS 세션만.
async function handlers() {
  const supabase = await createSupabaseServerClient();
  return createCapturesHandlers({
    backend: createSupabaseCapturesBackend(supabase),
    captureEnabled: isCaptureEnabled,
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
