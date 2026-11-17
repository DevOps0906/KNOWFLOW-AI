import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/app-shell/theme-provider";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";

vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});

it("클라이언트 렌더에서 script 태그 경고를 내지 않는다", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ThemeProvider>
      <p>내용</p>
    </ThemeProvider>
  );
  const scriptWarnings = error.mock.calls.filter((call) => String(call[0]).includes("script tag"));
  error.mockRestore();
  expect(scriptWarnings).toEqual([]);
});

it("토글하면 html에 dark 클래스가 붙고 저장된다", () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "다크 모드로 전환" }));
  });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(screen.getByRole("button", { name: "라이트 모드로 전환" })).toBeTruthy();
});

it("서버 HTML(실행 타입 스크립트)을 하이드레이션해도 경고가 없다", async () => {
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");
  const tree = (
    <ThemeProvider>
      <p>내용</p>
    </ThemeProvider>
  );
  // 서버는 type 없이 내보낸다(typeof window === "undefined").
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree).replace(' type="application/json"', "");
  expect(container.querySelector("script")?.getAttribute("type")).toBeNull();
  document.body.appendChild(container);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, tree);
  });
  const calls = error.mock.calls.map((call) => String(call[0]));
  error.mockRestore();
  act(() => root?.unmount());
  container.remove();
  expect(calls).toEqual([]);
});
