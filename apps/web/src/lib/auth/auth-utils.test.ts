import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./client-ip";
import { decideAccess } from "./paths";
import { safeNextPath } from "./redirect";
import { normalizeEmail, passwordProblem } from "./validation";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFromHeaders", () => {
  it("x-real-ip만 믿고 x-forwarded-for는 무시한다", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });
  it("형식이 틀린 값은 버린다", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "not-an-ip" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-real-ip": "1.2.3.4, 5.6.7.8" }))).toBeNull();
  });
  it("IPv6는 /64 단위로 묶는다", () => {
    const a = clientIpFromHeaders(h({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }));
    const b = clientIpFromHeaders(h({ "x-real-ip": "2001:db8:1:2::1" }));
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
    expect(clientIpFromHeaders(h({ "x-real-ip": "2001:db8:1:3::1" }))).not.toBe(a);
  });
  it("IPv4 매핑 IPv6는 IPv4로 본다", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "::ffff:198.51.100.7" }))).toBe("198.51.100.7");
  });
});

describe("validation", () => {
  it("이메일을 정규화하고 잘못된 형식은 null", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
  it("약한 비밀번호를 거른다", () => {
    expect(passwordProblem("short1!")).toBe("short");
    expect(passwordProblem("onlyletterslong")).toBe("classes");
    expect(passwordProblem("1234567890123")).toBe("classes");
    expect(passwordProblem("aaaaaaaaaa1")).toBe("repetitive");
    expect(passwordProblem("password-2024!")).toBe("common");
    expect(passwordProblem("johnsmith-1234", "johnsmith@example.test")).toBe("email");
    expect(passwordProblem("가".repeat(30) + "1")).toBe("long");
  });
  it("충분한 비밀번호는 통과(한글 포함)", () => {
    expect(passwordProblem("tulip-garden-4821!")).toBeNull();
    expect(passwordProblem("지식작업공간2026!")).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("같은 사이트의 경로만 허용한다", () => {
    expect(safeNextPath("/projects?x=1")).toBe("/projects?x=1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", undefined, "/a\nb"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("decideAccess", () => {
  it("미로그인 상태에서 보호 경로는 로그인으로, API는 401로 보낸다", () => {
    expect(decideAccess("/dashboard", false)).toEqual({ kind: "login", api: false });
    expect(decideAccess("/projects/abc", false)).toEqual({ kind: "login", api: false });
    expect(decideAccess("/api/projects", false)).toEqual({ kind: "login", api: true });
  });
  it("공개 경로와 인증 API는 미로그인도 통과한다", () => {
    for (const p of ["/", "/login", "/signup", "/reset-password", "/api/auth/login", "/nope"]) {
      expect(decideAccess(p, false)).toEqual({ kind: "allow" });
    }
  });
  it("접두어가 비슷한 경로를 오인하지 않는다", () => {
    expect(decideAccess("/projectsX", false)).toEqual({ kind: "allow" });
  });
  it("로그인 사용자는 보호 경로를 쓰고 로그인·가입 화면에서는 대시보드로 간다", () => {
    expect(decideAccess("/projects", true)).toEqual({ kind: "allow" });
    expect(decideAccess("/login", true)).toEqual({ kind: "home" });
    expect(decideAccess("/signup", true)).toEqual({ kind: "home" });
    expect(decideAccess("/reset-password", true)).toEqual({ kind: "allow" });
  });
});
