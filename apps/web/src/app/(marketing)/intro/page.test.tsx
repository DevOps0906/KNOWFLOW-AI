import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
import LandingPage from "./page";
import { PreorderCta } from "../preorder-cta";
import { buildPreorderHref } from "../preorder";

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
  it("섹션 ①~⑧이 렌더되고 CTA 링크가 맞다", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("지식 워크스페이스");
    for (const name of [
      "흩어진 자료를 한곳으로",
      "근거를 눌러 원문에서 확인",
      "자료에서 출처 달린 리포트로",
      "읽다가 막히면 바로 묻기",
      "폴더로 모아 정리",
      "지금 자료를 올려 보세요",
      "사전예약 개인정보 수집 안내",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getAllByRole("link", { name: "시작하기" })[0].getAttribute("href")).toBe("/signup");
    expect(screen.getAllByRole("link", { name: "로그인" })[0].getAttribute("href")).toBe("/login");
    expect(screen.getAllByText("곧 지원").length).toBeGreaterThan(0);
    expect(container.textContent ?? "").not.toMatch(/무료로 시작|정확하다|환각 없음/);
  });
});
