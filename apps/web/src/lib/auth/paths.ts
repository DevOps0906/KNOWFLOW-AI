// 접근 제어 규칙(proxy가 사용). 보호 경로는 목록으로 명시한다(404 화면은 로그인 없이도 보인다).
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/projects",
  "/sources",
  "/reports",
  "/settings",
  "/api/projects",
  "/api/sources",
  "/api/conversations",
  "/api/reports",
  "/api/me",
];

/** 로그인한 사용자는 들어갈 필요가 없는 화면(재설정 화면은 세션이 필요하므로 제외) */
const GUEST_ONLY_PATHS = ["/login", "/signup"];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "login"; api: boolean }
  | { kind: "home" };

export function decideAccess(pathname: string, authenticated: boolean): AccessDecision {
  if (PROTECTED_PREFIXES.some((p) => matches(pathname, p))) {
    return authenticated ? { kind: "allow" } : { kind: "login", api: pathname.startsWith("/api/") };
  }
  if (authenticated && GUEST_ONLY_PATHS.some((p) => matches(pathname, p))) return { kind: "home" };
  return { kind: "allow" };
}
