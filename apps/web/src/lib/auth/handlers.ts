import { createHmac } from "node:crypto";
import { clientIpFromHeaders } from "./client-ip";
import type { AuthEvent, AuthLogger } from "./log";
import { AUTH_MESSAGES } from "./messages";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "./redirect";
import { normalizeEmail, passwordProblem } from "./validation";

export type RateScope = "login_ip" | "login_email" | "signup_ip" | "reset_ip" | "reset_email";

export type AuthFailureKind = "invalid_credentials" | "weak_password" | "already_registered" | "unknown";

/** Supabase Auth·Postgres 호출을 감싼 최소 인터페이스(테스트에서 대체한다). */
export interface AuthBackend {
  consumeRateLimit(scope: RateScope, keyHash: string): Promise<{ allowed: boolean; retryAfter: number }>;
  signUp(email: string, password: string): Promise<{ failure: AuthFailureKind | null; hasSession: boolean }>;
  signIn(email: string, password: string): Promise<{ failure: AuthFailureKind | null }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<{ failure: AuthFailureKind | null }>;
  getUserId(): Promise<string | null>;
}

export interface AuthDeps {
  backend: AuthBackend;
  /** 한도 키를 비식별화하는 서버 전용 비밀. 없으면 모든 요청을 거부한다(fail closed). */
  secret: string | undefined;
  /** 예: https://app.example.com — 재설정 링크와 Origin 검사의 기준. 요청 Host는 믿지 않는다. */
  siteUrl: string | undefined;
  log: AuthLogger;
}

const NO_STORE = { "Cache-Control": "no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return json(status, { error: { code, message } }, extra);
}

class Stop extends Error {
  constructor(readonly response: Response) {
    super("stop");
  }
}

export function createAuthHandlers(deps: AuthDeps) {
  const { backend, log } = deps;

  const ref = (scope: string, value: string) =>
    createHmac("sha256", deps.secret!).update(`${scope}:${value}`).digest("hex");

  function guard(request: Request) {
    if (!deps.secret || !deps.siteUrl) throw new Stop(fail(500, "server_error", AUTH_MESSAGES.server));
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(deps.siteUrl).origin) {
      throw new Stop(fail(400, "bad_request", AUTH_MESSAGES.invalidRequest));
    }
  }

  async function readBody(request: Request): Promise<Record<string, unknown>> {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      throw new Stop(fail(400, "bad_request", AUTH_MESSAGES.invalidRequest));
    }
    const text = await request.text();
    if (text.length > 4096) throw new Stop(fail(400, "bad_request", AUTH_MESSAGES.invalidRequest));
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch {
      // 아래에서 400
    }
    throw new Stop(fail(400, "bad_request", AUTH_MESSAGES.invalidRequest));
  }

  /** 한도 확인. 거부되면 429 + Retry-After, 한도 저장소 오류는 거부(500)로 처리한다. */
  async function enforce(
    event: AuthEvent["event"],
    checks: Array<[RateScope, string | null]>,
    refs: { emailRef?: string; ipRef?: string },
  ) {
    let retryAfter = 0;
    for (const [scope, value] of checks) {
      if (value === null) continue; // 신뢰할 IP 헤더가 없으면 IP 기준은 건너뛴다
      let result;
      try {
        result = await backend.consumeRateLimit(scope, ref(scope, value));
      } catch {
        log({ event, outcome: "failure", reason: "rate_limit_store_error", ...refs });
        throw new Stop(fail(500, "server_error", AUTH_MESSAGES.server));
      }
      if (!result.allowed) retryAfter = Math.max(retryAfter, result.retryAfter);
    }
    if (retryAfter > 0) {
      log({ event: "rate_limited", outcome: "denied", reason: event, ...refs });
      throw new Stop(fail(429, "rate_limited", AUTH_MESSAGES.rateLimited, { "Retry-After": String(retryAfter) }));
    }
  }

  const refsFor = (email: string | null, ip: string | null) => ({
    ...(email ? { emailRef: ref("log_email", email).slice(0, 12) } : {}),
    ...(ip ? { ipRef: ref("log_ip", ip).slice(0, 12) } : {}),
  });

  async function run(fn: () => Promise<Response>): Promise<Response> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Stop) return e.response;
      return fail(500, "server_error", AUTH_MESSAGES.server);
    }
  }

  return {
    signup: (request: Request) =>
      run(async () => {
        guard(request);
        const body = await readBody(request);
        const email = normalizeEmail(body.email);
        if (!email) return fail(400, "invalid_email", AUTH_MESSAGES.invalidEmail);
        if (passwordProblem(body.password, email)) return fail(422, "weak_password", AUTH_MESSAGES.weakPassword);

        const ip = clientIpFromHeaders(request.headers);
        const refs = refsFor(email, ip);
        await enforce("signup", [["signup_ip", ip]], refs);

        const result = await backend.signUp(email, body.password as string);
        if (result.failure === "already_registered") {
          log({ event: "signup", outcome: "failure", reason: "already_registered", ...refs });
          return fail(409, "already_registered", AUTH_MESSAGES.alreadyRegistered);
        }
        if (result.failure === "weak_password") return fail(422, "weak_password", AUTH_MESSAGES.weakPassword);
        if (result.failure) {
          log({ event: "signup", outcome: "failure", reason: "backend_error", ...refs });
          return fail(500, "server_error", AUTH_MESSAGES.server);
        }
        log({ event: "signup", outcome: "success", ...refs });
        return result.hasSession
          ? json(200, { ok: true, redirectTo: "/onboarding" })
          : json(200, { ok: true, needsEmailConfirmation: true, message: AUTH_MESSAGES.confirmEmail });
      }),

    login: (request: Request) =>
      run(async () => {
        guard(request);
        const body = await readBody(request);
        const email = normalizeEmail(body.email);
        if (!email || typeof body.password !== "string" || body.password.length === 0 || body.password.length > 256) {
          return fail(400, "bad_request", AUTH_MESSAGES.invalidRequest);
        }
        const ip = clientIpFromHeaders(request.headers);
        const refs = refsFor(email, ip);
        await enforce("login", [["login_ip", ip], ["login_email", email]], refs);

        const result = await backend.signIn(email, body.password);
        if (result.failure === "invalid_credentials") {
          log({ event: "login", outcome: "failure", reason: "invalid_credentials", ...refs });
          return fail(401, "invalid_credentials", AUTH_MESSAGES.invalidCredentials);
        }
        if (result.failure) {
          log({ event: "login", outcome: "failure", reason: "backend_error", ...refs });
          return fail(500, "server_error", AUTH_MESSAGES.server);
        }
        log({ event: "login", outcome: "success", ...refs });
        return json(200, { ok: true, redirectTo: safeNextPath(body.next, DEFAULT_AFTER_LOGIN) });
      }),

    logout: (request: Request) =>
      run(async () => {
        guard(request);
        const userId = await backend.getUserId();
        if (!userId) return fail(401, "unauthorized", AUTH_MESSAGES.unauthorized);
        await backend.signOut();
        log({ event: "logout", outcome: "success", userId });
        return json(200, { ok: true });
      }),

    resetPassword: (request: Request) =>
      run(async () => {
        guard(request);
        const body = await readBody(request);
        const email = normalizeEmail(body.email);
        if (!email) return fail(400, "invalid_email", AUTH_MESSAGES.invalidEmail);
        const ip = clientIpFromHeaders(request.headers);
        const refs = refsFor(email, ip);
        // 한도는 가입 여부와 무관하게 입력한 주소 기준으로 센다(응답으로 가입 여부가 새지 않는다)
        await enforce("reset_request", [["reset_ip", ip], ["reset_email", email]], refs);

        const redirectTo = `${new URL(deps.siteUrl!).origin}/api/auth/callback?next=${encodeURIComponent("/reset-password?mode=update")}`;
        try {
          await backend.requestPasswordReset(email, redirectTo);
          log({ event: "reset_request", outcome: "success", ...refs });
        } catch {
          log({ event: "reset_request", outcome: "failure", reason: "backend_error", ...refs });
        }
        return json(200, { ok: true, message: AUTH_MESSAGES.resetSent });
      }),

    updatePassword: (request: Request) =>
      run(async () => {
        guard(request);
        const userId = await backend.getUserId();
        if (!userId) return fail(401, "unauthorized", AUTH_MESSAGES.unauthorized);
        const body = await readBody(request);
        if (passwordProblem(body.password)) return fail(422, "weak_password", AUTH_MESSAGES.weakPassword);

        const result = await backend.updatePassword(body.password as string);
        if (result.failure === "weak_password") return fail(422, "weak_password", AUTH_MESSAGES.weakPassword);
        if (result.failure) {
          log({ event: "password_update", outcome: "failure", reason: "backend_error", userId });
          return fail(500, "server_error", AUTH_MESSAGES.server);
        }
        log({ event: "password_update", outcome: "success", userId });
        return json(200, { ok: true });
      }),
  };
}
