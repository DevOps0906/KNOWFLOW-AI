import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(cleanup);

vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));

describe("상태 컴포넌트", () => {
  it("빈 상태는 제목·설명과 행동을 보여 준다", () => {
    render(
      <EmptyState icon={<Inbox />} title="프로젝트가 없습니다" description="첫 프로젝트를 만들어 보세요.">
        <button>새 프로젝트</button>
      </EmptyState>
    );
    expect(screen.getByRole("heading", { name: "프로젝트가 없습니다" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 프로젝트" })).toBeTruthy();
  });

  it("로딩 상태는 busy status로 알린다", () => {
    render(<LoadingState />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("불러오는 중")).toBeTruthy();
  });

  it("오류 상태는 alert이며 다시 시도를 호출한다", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /다시 시도/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("처리 상태 배지", () => {
  it("상태 글자를 함께 표시한다", () => {
    render(<StatusBadge status="fail" />);
    expect(screen.getByText("실패")).toBeTruthy();
  });
});

describe("앱 셸", () => {
  it("현재 경로를 aria-current로 표시하고 모바일 메뉴 버튼을 둔다", () => {
    render(
      <AppShell>
        <p>본문</p>
      </AppShell>
    );
    const current = screen.getAllByRole("link", { name: "프로젝트" })[0];
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeTruthy();
    expect(screen.getByText("본문")).toBeTruthy();
  });

  it("메뉴 버튼으로 시트를 열면 dialog가 나타난다", () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getByRole("dialog", { name: "메뉴" })).toBeTruthy();
  });
});

describe("앱 셸 반응형", () => {
  it("768 이상으로 넓어지면 시트를 닫고 언마운트 시 리스너를 해제한다", () => {
    let listener: ((e: { matches: boolean }) => void) | undefined;
    const remove = vi.fn();
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: (_: string, fn: typeof listener) => (listener = fn),
      removeEventListener: remove,
    }));
    const { unmount } = render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getByRole("dialog", { name: "메뉴" })).toBeTruthy();
    act(() => listener?.({ matches: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    expect(remove).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
