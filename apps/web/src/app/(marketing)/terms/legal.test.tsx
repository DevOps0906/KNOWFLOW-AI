import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "../privacy/page";
import { getRightsContactEmail } from "./rights-contact";
import TermsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("getRightsContactEmail", () => {
  it("미설정·빈 값·잘못된 값은 null", () => {
    expect(getRightsContactEmail(undefined)).toBeNull();
    expect(getRightsContactEmail("  ")).toBeNull();
    expect(getRightsContactEmail("not-an-email")).toBeNull();
    expect(getRightsContactEmail("a@b.co,c@d.co")).toBeNull();
    expect(getRightsContactEmail("a@b.co?cc=x@y.co")).toBeNull();
    expect(getRightsContactEmail("a@b.co&bcc=x@y.co")).toBeNull();
  });
  it("정상 주소는 그대로", () => {
    expect(getRightsContactEmail(" rights@example.com ")).toBe("rights@example.com");
  });
});

describe("S-16 이용약관", () => {
  it("초안 표시·본문·준비 중·개인정보처리방침 링크", () => {
    vi.stubEnv("RIGHTS_CONTACT_EMAIL", "");
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "이용약관" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("초안");
    expect(screen.getByRole("heading", { name: /YouTube 서비스 약관 고지/ })).toBeTruthy();
    expect(screen.getByText("준비 중")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /@/ })).toBeNull();
    expect(screen.getByRole("link", { name: "개인정보처리방침" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "이전으로" })).toBeTruthy();
  });
  it("이메일이 설정되면 mailto 링크", () => {
    vi.stubEnv("RIGHTS_CONTACT_EMAIL", "rights@example.com");
    render(<TermsPage />);
    expect(screen.getByRole("link", { name: "rights@example.com" }).getAttribute("href")).toBe("mailto:rights@example.com");
    expect(screen.queryByText("준비 중")).toBeNull();
  });
});

describe("S-17 개인정보처리방침", () => {
  it("초안 표시·국외 이전(Google·Gemini)·Google 정책 링크 문구·이용약관 링크", () => {
    vi.stubEnv("RIGHTS_CONTACT_EMAIL", "");
    const { container } = render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "개인정보처리방침" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("초안");
    expect(screen.getByRole("heading", { name: /국외 이전/ })).toBeTruthy();
    expect(container.textContent).toMatch(/Google.*Gemini|Gemini.*Google/);
    expect(container.textContent).toContain("policies.google.com/privacy");
    expect(screen.getByText("준비 중")).toBeTruthy();
    expect(screen.getByRole("link", { name: "이용약관" }).getAttribute("href")).toBe("/terms");
  });
});
