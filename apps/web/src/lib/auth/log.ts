// 인증 이벤트 로그. 비밀번호·토큰·쿠키·원본 이메일·원본 IP는 남기지 않는다.
export type AuthEventName =
  | "signup"
  | "login"
  | "logout"
  | "reset_request"
  | "password_update"
  | "rate_limited"
  | "callback";

export interface AuthEvent {
  event: AuthEventName;
  outcome: "success" | "failure" | "denied";
  /** 실패 사유 코드(고정 문자열만) */
  reason?: string;
  /** 이메일·IP를 HMAC으로 줄인 앞 12자리(상관관계 추적용, 복원 불가) */
  emailRef?: string;
  ipRef?: string;
  userId?: string;
}

export type AuthLogger = (event: AuthEvent) => void;

const ALLOWED_KEYS = new Set<keyof AuthEvent>(["event", "outcome", "reason", "emailRef", "ipRef", "userId"]);

/** 허용 목록에 있는 키만 통과시킨다(실수로 객체를 통째로 넘겨도 새지 않는다). */
export function sanitizeAuthEvent(event: AuthEvent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(event)) {
    if (ALLOWED_KEYS.has(key as keyof AuthEvent) && typeof value === "string") out[key] = value.slice(0, 64);
  }
  return out;
}

export const logAuthEvent: AuthLogger = (event) => {
  console.info(JSON.stringify({ type: "auth_event", at: new Date().toISOString(), ...sanitizeAuthEvent(event) }));
};
