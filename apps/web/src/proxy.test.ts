// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));

import { proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
  getUser.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("proxy", () => {
  it("미로그인으로 보호 경로에 가면 로그인 화면으로 이동하고 원래 경로를 넘긴다", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req("/projects?tab=1"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/projects?tab=1");
  });

  it("미로그인 보호 API는 401 JSON", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req("/api/projects"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("로그인 상태면 보호 경로를 통과시킨다", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await proxy(req("/projects"));
    expect(res.status).toBe(200);
  });

  it("토큰 검증이 예외를 던지면 미로그인으로 취급한다", async () => {
    getUser.mockRejectedValue(new Error("network"));
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
  });

  it("환경 변수가 없으면 보호 경로는 닫힌다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("공개 경로는 로그인 없이 통과한다", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await proxy(req("/"))).status).toBe(200);
    expect((await proxy(req("/login"))).status).toBe(200);
  });
});
