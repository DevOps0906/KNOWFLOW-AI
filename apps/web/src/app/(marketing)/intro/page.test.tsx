import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
import LandingPage from "./page";
import { PreorderCta } from "./preorder-cta";
import { buildPreorderHref } from "./preorder";

afterEach(cleanup);

const HOST = "tally.so";

describe("buildPreorderHref", () => {
  it("빈 값·http·다른 호스트·잘못된 URL은 null", () => {
    expect(buildPreorderHref("", HOST)).toBeNull();
    expect(buildPreorderHref("http://tally.so/r/abc", HOST)).toBeNull();
    expect(buildPreorderHref("https://evil.example/r/abc", HOST)).toBeNull();
    expect(buildPreorderHref("https://tally.so.evil.example/r/abc", HOST)).toBeNull();
    expect(buildPreorderHref("not a url", HOST)).toBeNull();
    expect(buildPreorderHref("https://user:pw@tally.so/r/abc", HOST)).toBeNull();
    expect(buildPreorderHref("https://tally.so:8443/r/abc", HOST)).toBeNull();
  });
  it("허용 호스트 https는 src 파라미터를 붙인다", () => {
    expect(buildPreorderHref("https://tally.so/r/abc", HOST)).toBe(
      "https://tally.so/r/abc?src=knowflow-landing",
    );
  });
});

describe("PreorderCta", () => {
  it("href 없으면 비활성 버튼", () => {
    render(<PreorderCta href={null} />);
    expect((screen.getByRole("button", { name: "사전예약 준비 중" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("href 있으면 rel 지정된 새 탭 링크", () => {
    render(<PreorderCta href="https://tally.so/r/abc?src=knowflow-landing" />);
    const a = screen.getByRole("link", { name: "사전예약" });
    expect(a.getAttribute("href")).toBe("https://tally.so/r/abc?src=knowflow-landing");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("S-01 랜딩", () => {
  it("핵심 구성이 렌더되고 로그인·금지 문구가 없다", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1, name: "자료로 답하는 지식 워크스페이스" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "만들고 있는 기능" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "사전예약 개인정보 수집 안내" })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/무료로 시작|로그인|정확하다|환각 없음/);
  });
});
