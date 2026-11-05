const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON_PASSWORDS = ["password", "qwerty", "1234567890", "abcdefghij", "iloveyou", "letmein", "welcome"];

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt 한계(바이트). 넘는 입력은 뒷부분이 무시되므로 거부한다. */
export const PASSWORD_MAX_BYTES = 72;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/** 통과하면 null, 약하면 이유 코드(사용자 문구는 하나로 통일한다). */
export function passwordProblem(raw: unknown, email?: string | null): string | null {
  if (typeof raw !== "string") return "type";
  const length = Array.from(raw).length;
  if (length < PASSWORD_MIN_LENGTH) return "short";
  if (new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) return "long";
  if (!/\p{L}/u.test(raw) || !/[\p{N}\p{P}\p{S}]/u.test(raw)) return "classes";
  if (new Set(Array.from(raw)).size < 4) return "repetitive";
  const lower = raw.toLowerCase();
  if (COMMON_PASSWORDS.some((p) => lower.includes(p))) return "common";
  const local = email?.split("@")[0];
  if (local && local.length >= 4 && lower.includes(local)) return "email";
  return null;
}
