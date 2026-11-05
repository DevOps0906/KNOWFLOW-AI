// 브라우저에서 /api/auth/* 를 부르는 공통 함수. 응답 형식은 docs/04_API.md 공통 규칙({error:{code,message}}).
export interface AuthResult {
  ok: boolean;
  status: number;
  message?: string;
  retryAfter?: number;
  redirectTo?: string;
  needsEmailConfirmation?: boolean;
}

export async function postAuth(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      redirectTo?: string;
      needsEmailConfirmation?: boolean;
      error?: { message?: string };
    };
    const retryAfter = Number(response.headers.get("Retry-After")) || undefined;
    return {
      ok: response.ok,
      status: response.status,
      message: data.error?.message ?? data.message,
      retryAfter,
      redirectTo: data.redirectTo,
      needsEmailConfirmation: data.needsEmailConfirmation,
    };
  } catch {
    return { ok: false, status: 0, message: "네트워크 연결을 확인하고 다시 시도해 주세요." };
  }
}
