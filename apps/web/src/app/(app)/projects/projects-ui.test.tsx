import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectItem } from "@/lib/projects/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

import { OnboardingWizard } from "../onboarding/onboarding-wizard";
import { ProjectRowActions } from "./project-dialogs";
import { EmptyProjects, ProjectList } from "./project-list";

const project: ProjectItem = {
  id: "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22",
  name: "시장 조사",
  description: "경쟁사 자료",
  status: "active",
  sourceCount: 2,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("프로젝트 화면 조각", () => {
  it("목록 행에 이름 링크·자료 수·상태가 보인다", () => {
    render(<ProjectList items={[project, { ...project, id: "b", name: "보관본", status: "archived", sourceCount: 0 }]} withActions={false} />);
    expect(screen.getByRole("link", { name: "시장 조사" }).getAttribute("href")).toBe(`/projects/${project.id}`);
    expect(screen.getByText("자료 2개")).toBeTruthy();
    expect(screen.getByText("보관됨")).toBeTruthy();
  });

  it("프로젝트가 없으면 안내와 새 프로젝트 버튼, 조건 검색이면 안내만 보인다", () => {
    const { unmount } = render(<EmptyProjects />);
    expect(screen.getByText("아직 프로젝트가 없습니다")).toBeTruthy();
    expect(screen.getByRole("button", { name: /새 프로젝트/ })).toBeTruthy();
    unmount();
    render(<EmptyProjects filtered />);
    expect(screen.getByText("조건에 맞는 프로젝트가 없습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /새 프로젝트/ })).toBeNull();
  });

  it("보관 버튼은 PATCH로 보관 상태를 바꾸고 목록을 새로 읽는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: project.id }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectRowActions project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "시장 조사 보관" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`/api/projects/${project.id}`);
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(String(call[1].body))).toEqual({ archived: true });
  });

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
