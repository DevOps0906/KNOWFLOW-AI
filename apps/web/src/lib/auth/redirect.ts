export const DEFAULT_AFTER_LOGIN = "/dashboard";

/** 열린 리디렉션 방지: 같은 사이트의 절대 경로만 허용한다. */
export function safeNextPath(next: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 200) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
