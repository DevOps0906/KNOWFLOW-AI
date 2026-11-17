// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
let youtube = true;

vi.mock("next/navigation", () => ({ redirect }));
let configured = true;
vi.mock("@/lib/projects/server", () => ({
  serverSupabaseOrNull: async () => (configured ? { auth: { getUser } } : null),
}));
vi.mock("@/lib/projects/folders", () => ({ loadFolders: async () => [] }));
vi.mock("@/server/youtube/service", () => ({ isYoutubeEnabled: () => youtube }));
vi.mock("@/components/import/source-import", () => ({ SourceImport: () => null }));

import HomePage from "./page";

const params = Promise.resolve({});

beforeEach(() => {
  getUser.mockReset();
  redirect.mockClear();
  youtube = true;
  configured = true;
});

describe("fail-closed", () => {
  it("Supabase 미설정이면 /와 /new/source 모두 /login으로 보낸다", async () => {
    configured = false;
    const home = HomePage({ searchParams: params }) as { type: (p: unknown) => Promise<unknown>; props: unknown };
    await expect(home.type(home.props)).rejects.toThrow("REDIRECT:/login");
    const { ImportPage } = await import("./new/source/import-page");
    await expect(ImportPage({ tab: "pdf", searchParams: params })).rejects.toThrow("REDIRECT:/login");
  });

  it("사용자 조회가 실패해도 /login으로 보낸다", async () => {
    getUser.mockRejectedValue(new Error("boom"));
    const { ImportPage } = await import("./new/source/import-page");
    await expect(ImportPage({ tab: "pdf", searchParams: params })).rejects.toThrow("REDIRECT:/login");
  });
});

describe("홈(/)", () => {
  it("비로그인은 next 없이 /login으로 보낸다", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const el = HomePage({ searchParams: params }) as { type: (p: unknown) => Promise<unknown>; props: unknown };
    await expect(el.type(el.props)).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("로그인하면 유튜브 탭 가져오기 화면을 그린다", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const el = HomePage({ searchParams: params }) as { type: (p: unknown) => Promise<unknown>; props: { tab: string } };
    expect(el.props.tab).toBe("youtube");
    await el.type(el.props);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("유튜브가 꺼져 있으면 문서 탭을 그린다", async () => {
    youtube = false;
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const el = HomePage({ searchParams: params }) as { type: (p: unknown) => Promise<unknown>; props: { tab: string } };
    expect(el.props.tab).toBe("pdf");
    await el.type(el.props);
    expect(redirect).not.toHaveBeenCalled();
  });
});
