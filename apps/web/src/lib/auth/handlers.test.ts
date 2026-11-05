import { describe, expect, it, vi } from "vitest";
import { createAuthHandlers, type AuthBackend, type RateScope } from "./handlers";
import type { AuthEvent } from "./log";

const SECRET = "test-secret-test-secret-test-secret-0123";
const SITE = "https://app.example.test";
const LIMITS: Record<RateScope, number> = { login_ip: 5, login_email: 5, signup_ip: 10, reset_ip: 10, reset_email: 3 };
const GOOD_PASSWORD = "tulip-garden-4821!";

function setup(overrides: Partial<AuthBackend> = {}, opts: { secret?: string | undefined } = {}) {
  const counters = new Map<string, number>();
  const logs: AuthEvent[] = [];
  const backend: AuthBackend = {
    async consumeRateLimit(scope, keyHash) {
      const key = `${scope}:${keyHash}`;
      const hits = (counters.get(key) ?? 0) + 1;
      counters.set(key, hits);
      return hits > LIMITS[scope] ? { allowed: false, retryAfter: 42 } : { allowed: true, retryAfter: 0 };
    },
    signUp: vi.fn(async () => ({ failure: null, hasSession: true })),
    signIn: vi.fn(async (_email: string, password: string) => ({
      failure: password === GOOD_PASSWORD ? null : ("invalid_credentials" as const),
    })),
    signOut: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => ({ failure: null })),
    getUserId: vi.fn(async () => "user-1"),
    ...overrides,
  };
  const handlers = createAuthHandlers({
    backend,
    secret: "secret" in opts ? opts.secret : SECRET,
    siteUrl: SITE,
    log: (e) => logs.push(e),
  });
  return { handlers, backend, logs, counters };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/auth/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("로그인 한도", () => {
  it("같은 계정으로 5번 틀리면 6번째 시도는 429와 Retry-After를 받는다", async () => {
    const { handlers } = setup();
    for (let i = 0; i < 5; i++) {
      const res = await handlers.login(post({ email: "a@example.test", password: "wrong-password-1" }));
      expect(res.status).toBe(401);
    }
    const sixth = await handlers.login(post({ email: "a@example.test", password: "wrong-password-1" }));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBe("42");
    expect((await sixth.json()).error.code).toBe("rate_limited");
  });

  it("한도가 막은 뒤에는 올바른 비밀번호도 인증기를 부르지 않는다", async () => {
    const { handlers, backend } = setup();
    for (let i = 0; i < 5; i++) await handlers.login(post({ email: "a@example.test", password: "wrong-password-1" }));
    const res = await handlers.login(post({ email: "a@example.test", password: GOOD_PASSWORD }));
    expect(res.status).toBe(429);
    expect(backend.signIn).toHaveBeenCalledTimes(5);
  });

  it("X-Forwarded-For를 바꿔도 한도를 우회할 수 없다(신뢰 헤더는 x-real-ip뿐)", async () => {
    const { handlers, counters } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await handlers.login(
        post(
          { email: `u${i}@example.test`, password: "wrong-password-1" },
          { "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": "198.51.100.7" },
        ),
      );
      statuses.push(res.status);
    }
    // 이메일이 달라도 같은 x-real-ip라서 IP 한도(5)에 걸린다
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect([...counters.keys()].filter((k) => k.startsWith("login_ip:"))).toHaveLength(1);
  });

  it("x-real-ip가 없을 때 위조한 X-Forwarded-For는 IP 한도 키로 쓰이지 않는다", async () => {
    const { handlers, counters } = setup();
    for (let i = 0; i < 3; i++) {
      await handlers.login(post({ email: "a@example.test", password: "wrong-password-1" }, { "x-forwarded-for": `203.0.113.${i}` }));
    }
    expect([...counters.keys()].some((k) => k.startsWith("login_ip:"))).toBe(false);
    expect([...counters.keys()].filter((k) => k.startsWith("login_email:"))).toHaveLength(1);
  });

  it("한도 저장소가 실패하면 요청을 통과시키지 않는다(fail closed)", async () => {
    const { handlers, backend } = setup({
      consumeRateLimit: async () => {
        throw new Error("db down");
      },
    });
    const res = await handlers.login(post({ email: "a@example.test", password: GOOD_PASSWORD }));
    expect(res.status).toBe(500);
    expect(backend.signIn).not.toHaveBeenCalled();
  });

  it("성공하면 안전한 이동 경로만 돌려준다", async () => {
    const { handlers } = setup();
    const ok = await handlers.login(post({ email: "a@example.test", password: GOOD_PASSWORD, next: "/projects" }));
    expect((await ok.json()).redirectTo).toBe("/projects");
    const evil = await handlers.login(post({ email: "b@example.test", password: GOOD_PASSWORD, next: "https://evil.test" }));
    expect((await evil.json()).redirectTo).toBe("/dashboard");
  });
});

describe("비밀번호 재설정", () => {
  it("가입하지 않은 이메일도 가입한 이메일과 같은 응답을 받는다", async () => {
    const throwsForUnknown = vi.fn(async (email: string) => {
      if (email === "unknown@example.test") throw new Error("user not found");
    });
    const { handlers } = setup({ requestPasswordReset: throwsForUnknown });
    const known = await handlers.resetPassword(post({ email: "known@example.test" }));
    const unknown = await handlers.resetPassword(post({ email: "unknown@example.test" }));
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("같은 계정은 시간당 3번까지, 4번째는 가입 여부와 무관하게 429", async () => {
    const { handlers } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await handlers.resetPassword(post({ email: "x@example.test" }))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("재설정 링크는 요청 Host가 아니라 설정된 사이트 주소로 만든다", async () => {
    const request = vi.fn(async () => {});
    const { handlers } = setup({ requestPasswordReset: request });
    await handlers.resetPassword(post({ email: "x@example.test" }, { host: "evil.test" }));
    const redirectTo = (request.mock.calls[0] as unknown as [string, string])[1];
    expect(redirectTo.startsWith(`${SITE}/api/auth/callback`)).toBe(true);
  });

  it("이메일 형식이 아니면 400", async () => {
    const { handlers } = setup();
    expect((await handlers.resetPassword(post({ email: "not-an-email" }))).status).toBe(400);
  });
});

describe("가입·비밀번호 변경", () => {
  it("약한 비밀번호는 422", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.signup(post({ email: "a@example.test", password: "short1!" }));
    expect(res.status).toBe(422);
    expect(backend.signUp).not.toHaveBeenCalled();
    const change = await handlers.updatePassword(post({ password: "aaaaaaaaaaaa" }));
    expect(change.status).toBe(422);
  });

  it("이미 가입된 이메일은 409", async () => {
    const { handlers } = setup({ signUp: async () => ({ failure: "already_registered", hasSession: false }) });
    const res = await handlers.signup(post({ email: "a@example.test", password: GOOD_PASSWORD }));
    expect(res.status).toBe(409);
  });

  it("이메일 확인이 필요하면 안내를 돌려준다", async () => {
    const { handlers } = setup({ signUp: async () => ({ failure: null, hasSession: false }) });
    const res = await handlers.signup(post({ email: "a@example.test", password: GOOD_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.json()).needsEmailConfirmation).toBe(true);
  });

  it("로그인하지 않으면 로그아웃·비밀번호 변경은 401", async () => {
    const { handlers } = setup({ getUserId: async () => null });
    expect((await handlers.logout(post({}))).status).toBe(401);
    expect((await handlers.updatePassword(post({ password: GOOD_PASSWORD }))).status).toBe(401);
  });
});

describe("요청 검증", () => {
  it("다른 출처(Origin)의 요청은 거부한다", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.login(post({ email: "a@example.test", password: GOOD_PASSWORD }, { origin: "https://evil.test" }));
    expect(res.status).toBe(400);
    expect(backend.signIn).not.toHaveBeenCalled();
  });

  it("JSON이 아니거나 깨진 본문은 400", async () => {
    const { handlers } = setup();
    expect((await handlers.login(post("{broken"))).status).toBe(400);
    expect((await handlers.login(post("email=a", { "content-type": "text/plain" }))).status).toBe(400);
  });

  it("비밀 값이 설정되지 않으면 모든 요청을 거부한다", async () => {
    const { handlers, backend } = setup({}, { secret: undefined });
    const res = await handlers.login(post({ email: "a@example.test", password: GOOD_PASSWORD }));
    expect(res.status).toBe(500);
    expect(backend.signIn).not.toHaveBeenCalled();
  });
});

describe("로그와 응답에 비밀이 남지 않는다", () => {
  it("로그에 비밀번호·이메일 원문·IP 원문이 없다", async () => {
    const password = "Very-Secret-Pass-9981#";
    const { handlers, logs } = setup();
    await handlers.login(post({ email: "person@example.test", password }, { "x-real-ip": "198.51.100.9" }));
    await handlers.signup(post({ email: "person2@example.test", password }, { "x-real-ip": "198.51.100.9" }));
    await handlers.resetPassword(post({ email: "person3@example.test" }, { "x-real-ip": "198.51.100.9" }));
    expect(logs.length).toBeGreaterThan(0);
    const dump = JSON.stringify(logs);
    for (const secret of [password, "person@example.test", "person2@example.test", "198.51.100.9", SECRET]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("기본 로거는 console에 JSON 한 줄을 남기고 허용되지 않은 필드는 버린다", async () => {
    const { logAuthEvent } = await import("./log");
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logAuthEvent({ event: "login", outcome: "failure", reason: "x", password: "p4ssw0rd-leak", token: "tok" } as unknown as AuthEvent);
    const line = String(spy.mock.calls[0]?.[0]);
    spy.mockRestore();
    expect(line).not.toContain("p4ssw0rd-leak");
    expect(line).not.toContain("tok");
    expect(JSON.parse(line).event).toBe("login");
  });

  it("응답 본문에 비밀번호를 되돌려주지 않는다", async () => {
    const { handlers } = setup();
    const res = await handlers.login(post({ email: "a@example.test", password: "wrong-password-1" }));
    expect(await res.text()).not.toContain("wrong-password-1");
  });
});
