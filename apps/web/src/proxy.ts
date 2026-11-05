import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/auth/paths";

// 인증 세션 갱신과 보호 경로 접근 제어(단독 소유: task-005). Next.js 16에서는 middleware가 proxy로 바뀌었다.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });
  let authenticated = false;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
        },
      },
    });
    try {
      // getSession이 아니라 getUser: 서버가 토큰을 검증한다
      const { data } = await supabase.auth.getUser();
      authenticated = Boolean(data.user);
    } catch {
      authenticated = false;
    }
  }
  // 환경 변수가 없으면 인증되지 않은 것으로 본다(보호 경로는 닫힌다)

  const decision = decideAccess(pathname, authenticated);
  if (decision.kind === "login") {
    if (decision.api) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "로그인이 필요합니다." } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (decision.kind === "home") return NextResponse.redirect(new URL("/dashboard", request.url));

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
