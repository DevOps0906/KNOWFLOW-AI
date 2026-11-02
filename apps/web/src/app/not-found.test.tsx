import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";
import ErrorPage from "./error";

afterEach(cleanup);

describe("S-14 not-found", () => {
  it("안내 문구와 홈 링크를 보여 준다", () => {
    render(<NotFound />);
    expect(screen.getByText("찾을 수 없거나 접근 권한이 없습니다")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "처음으로" }).getAttribute("href")).toBe("/");
  });
});

describe("S-15 error", () => {
  it("다시 시도가 reset을 호출하고 message는 노출하지 않는다", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("secret db password"), { digest: "abc123" });
    const { container } = render(<ErrorPage error={error} reset={reset} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "처음으로" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("abc123");
    expect(container.textContent).not.toContain("secret");
  });
});
