import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSourceReadHandlers } from "./handlers";
import { createSupabaseSourceReadBackend } from "./queries";

// 서버 전용: 요청 쿠키에 묶인 Supabase 클라이언트(anon 키 + 사용자 세션, RLS 적용)로 핸들러를 조립한다.
export async function sourceReadHandlersForRequest() {
  const supabase = await createSupabaseServerClient();
  return createSourceReadHandlers({ backend: createSupabaseSourceReadBackend(supabase), siteUrl: process.env.NEXT_PUBLIC_SITE_URL });
}
