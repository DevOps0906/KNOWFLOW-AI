import { NextResponse } from "next/server";
import { logAuthEvent } from "@/lib/auth/log";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient, supabaseEnv } from "@/lib/auth/supabase-server";

// 재설정 메일 링크가 돌아오는 곳(PKCE). 코드를 세션으로 바꾼 뒤 지정한 화면으로 보낸다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const base = siteUrl ? new URL(siteUrl).origin : new URL(request.url).origin;
  const failed = NextResponse.redirect(`${base}/reset-password?error=link`);

  if (!code || !supabaseEnv()) return failed;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logAuthEvent({ event: "callback", outcome: "failure", reason: "exchange_failed" });
      return failed;
    }
  } catch {
    logAuthEvent({ event: "callback", outcome: "failure", reason: "backend_error" });
    return failed;
  }
  logAuthEvent({ event: "callback", outcome: "success" });
  const response = NextResponse.redirect(`${base}${safeNextPath(searchParams.get("next"), "/reset-password?mode=update")}`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
