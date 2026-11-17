import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

import { OnboardingWizard } from "../onboarding/onboarding-wizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

// 프로젝트 목록 화면은 자료 라이브러리로 옮겨 갔다(테스트: components/library/library.test.tsx). 여기에는 온보딩만 남는다.
describe("온보딩", () => {
  it("온보딩은 이름을 입력해 프로젝트를 만들고 마지막 안내에서 대시보드로 안내한다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "x" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "첫 프로젝트" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "대시보드로 이동" }).getAttribute("href")).toBe("/dashboard"));
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ name: "첫 프로젝트" });
  });

  it("온보딩 생성 실패 시 오류와 건너뛰기를 보여준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "한도 초과" } }, { status: 429 })));
    render(<OnboardingWizard />);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("한도 초과"));
    expect(screen.getByRole("link", { name: "건너뛰기" }).getAttribute("href")).toBe("/dashboard");
  });
});
