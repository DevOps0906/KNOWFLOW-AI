import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import LoginPage from "../../(auth)/login/page";
import SignupPage from "../../(auth)/signup/page";
import LandingPage from "../page";
import PrivacyPage from "../privacy/page";
import { rightsContactEmail } from "./legal";
import TermsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("rightsContactEmail", () => {
  it("비었거나 형식이 아니면 null, 앞뒤 공백은 지운다", () => {
    expect(rightsContactEmail(undefined)).toBeNull();
    expect(rightsContactEmail("  ")).toBeNull();
    expect(rightsContactEmail("not-an-email")).toBeNull();
    expect(rightsContactEmail("a@b.c <x>")).toBeNull();
    expect(rightsContactEmail(" rights@example.test ")).toBe("rights@example.test");
  });
});

describe.each([
  { name: "S-16 이용약관", Page: TermsPage, title: "이용약관", other: { label: "개인정보처리방침 보기", href: "/privacy" } },
  { name: "S-17 개인정보처리방침", Page: PrivacyPage, title: "개인정보처리방침", other: { label: "이용약관 보기", href: "/terms" } },
])("$name", ({ Page, title, other }) => {
  it("초안 표시·제목·위치·이전으로·상대 문서 링크가 있다", () => {
    render(<Page />);
    expect(screen.getByRole("note").textContent).toContain("초안 — 법무 확인 전");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    const crumb = screen.getByRole("navigation", { name: "현재 위치" });
    expect(within(crumb).getByRole("link", { name: "홈" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: "이전으로" })).toBeTruthy();
    expect(screen.getByRole("link", { name: other.label }).getAttribute("href")).toBe(other.href);
  });

  it("신고 이메일이 없으면 준비 중 안내", () => {
    vi.stubEnv("RIGHTS_CONTACT_EMAIL", "");
    const { container } = render(<Page />);
    expect(container.textContent).toContain("신고 창구 준비 중입니다.");
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("신고 이메일이 있으면 mailto 링크", () => {
    vi.stubEnv("RIGHTS_CONTACT_EMAIL", "rights@example.test");
    render(<Page />);
    expect(screen.getByRole("link", { name: "rights@example.test" }).getAttribute("href")).toBe("mailto:rights@example.test");
  });
});

describe("고지 항목", () => {
  it("이용약관에 YouTube 약관 고지, 처리방침에 국외 이전(YouTube API·Gemini)과 Google 정책 링크", () => {
    render(<TermsPage />);
    expect(screen.getByRole("link", { name: "YouTube 서비스 약관" }).getAttribute("href")).toBe("https://www.youtube.com/t/terms");
    cleanup();
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("YouTube Data API");
    expect(text).toContain("Gemini API");
    expect(text).toContain("확인 필요");
    const google = screen.getByRole("link", { name: "Google 개인정보처리방침" });
    expect(google.getAttribute("href")).toBe("https://policies.google.com/privacy");
    expect(google.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("S-01·S-02·S-03 약관 링크", () => {
  it.each([
    ["S-01 랜딩", async () => <LandingPage />],
    ["S-02 로그인", async () => await LoginPage({ searchParams: Promise.resolve({}) })],
    ["S-03 가입", async () => <SignupPage />],
  ])("%s에 이용약관·개인정보처리방침 링크", async (_, el) => {
    render(await el());
    const nav = screen.getByRole("navigation", { name: "약관" });
    expect(within(nav).getByRole("link", { name: "이용약관" }).getAttribute("href")).toBe("/terms");
    expect(within(nav).getByRole("link", { name: "개인정보처리방침" }).getAttribute("href")).toBe("/privacy");
  });
});
