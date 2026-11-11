import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceErrorMessage } from "@/lib/sources/error-messages";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));

import { ChatPanel } from "@/components/chat/ChatPanel";
import { formatTimestamp, TimestampChip } from "./timestamp-chip";
import type { ProjectDetail, WorkspaceSource } from "./types";
import { POLL_MAX_MS, POLL_MIN_MS, nextPollDelay } from "./use-polling";
import { WorkspaceShell } from "./WorkspaceShell";

const PROJECT = "11111111-1111-4111-8111-111111111111";
let seq = 0;

function source(patch: Partial<WorkspaceSource> = {}): WorkspaceSource {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const errorCode = patch.error_code ?? null;
  return {
    id,
    project_id: PROJECT,
    source_type: "pdf",
    title: `자료 ${seq}`,
    status: "completed",
    error_code: errorCode,
    error_message: sourceErrorMessage(errorCode),
    unavailable_at: null,
    original_url: null,
    video_id: null,
    channel_title: null,
    duration_seconds: null,
    created_at: "2026-11-12T00:00:00Z",
    updated_at: "2026-11-12T00:00:00Z",
    latest_job: { id: `job-${seq}`, status: "succeeded", retryable: true },
    ...patch,
  };
}

function detail(sources: WorkspaceSource[], summary: string | null = null): ProjectDetail {
  return {
    project: {
      id: PROJECT,
      name: "시장 조사",
      description: null,
      status: "active",
      summary,
      suggested_questions: ["경쟁사는 누구인가요?"],
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
    },
    sources,
  };
}

function setViewport(mode: "mobile" | "tablet" | "desktop") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("75rem") ? mode === "desktop" : mode !== "mobile",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

beforeEach(() => {
  setViewport("desktop");
  setHidden(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("S-08 레이아웃 3구간", () => {
  // 배치는 CSS 구간(md=768·desk=1200)으로 첫 렌더부터 정해진다. jsdom은 CSS를 적용하지 않으므로 구간 클래스로 확인한다.
  it("데스크톱 3단(자료·요약과 원문·채팅), 태블릿 2단, 모바일 단일 열을 CSS 구간으로 나눈다", () => {
    render(<WorkspaceShell initial={detail([source()])} />);
    const grid = screen.getByRole("region", { name: "요약과 원문" }).parentElement!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-(--grid-workspace-tablet)");
    expect(grid.className).toContain("desk:grid-cols-(--grid-workspace-desk)");
    const sourcesCol = screen.getByRole("region", { name: "자료" }).className.split(" ");
    expect(sourcesCol).toEqual(expect.arrayContaining(["hidden", "desk:block"]));
    const chatCol = screen.getByRole("complementary", { name: "채팅" }).className.split(" ");
    expect(chatCol).toEqual(expect.arrayContaining(["hidden", "md:block"]));
    expect(screen.getByRole("button", { name: "자료 목록 열기 (1개)" }).className).toContain("desk:hidden");
    expect(screen.getByRole("button", { name: "질문하기" }).className).toContain("md:hidden");
  });

  it("태블릿은 자료를 옆 시트로 열고 닫으면 열기 버튼으로 포커스가 돌아간다", async () => {
    setViewport("tablet");
    render(<WorkspaceShell initial={detail([source({ title: "보고서" })])} />);
    const trigger = screen.getByRole("button", { name: "자료 목록 열기 (1개)" });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "자료" });
    expect(within(sheet).getByText("보고서")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("모바일은 채팅을 하단 시트로 열고, 닫으면 포커스가 돌아간다", async () => {
    setViewport("mobile");
    render(<WorkspaceShell initial={detail([source({ title: "보고서" })])} />);
    const chatTrigger = screen.getByRole("button", { name: "질문하기" });
    fireEvent.click(chatTrigger);
    const chat = await screen.findByRole("dialog", { name: "채팅" });
    expect(within(chat).getByText("경쟁사는 누구인가요?")).toBeTruthy();
    fireEvent.keyDown(chat, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(chatTrigger);
  });

  it("데스크톱에서는 시트가 열리지 않는다(넓어지면 닫힘)", () => {
    render(<WorkspaceShell initial={detail([source()])} />);
    fireEvent.click(screen.getByRole("button", { name: "자료 목록 열기 (1개)" }));
    fireEvent.click(screen.getByRole("button", { name: "질문하기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("자료가 없으면 안내와 자료 추가 버튼을 보여 준다", () => {
    render(<WorkspaceShell initial={detail([])} />);
    expect(screen.getByText("아직 자료가 없습니다")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /자료 추가/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/자료를 추가하면 분석이 끝난 뒤 요약/)).toBeTruthy();
  });
});

describe("S-08 자료 목록", () => {
  it("처리 상태 배지와 실패 문구를 보여 주고 원문 코드는 노출하지 않는다", () => {
    const { container } = render(
      <WorkspaceShell
        initial={detail([
          source({ status: "queued", title: "대기 자료" }),
          source({ status: "processing", title: "처리 자료" }),
          source({ status: "failed", title: "실패 자료", error_code: "parser_timeout" }),
          source({ status: "failed", title: "모르는 실패", error_code: "weird_internal_code" }),
        ])}
      />,
    );
    for (const label of ["대기", "처리 중", "실패"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText(sourceErrorMessage("parser_timeout")!)).toBeTruthy();
    expect(screen.getByText(sourceErrorMessage("weird_internal_code")!)).toBeTruthy();
    expect(container.textContent).not.toContain("parser_timeout");
    expect(container.textContent).not.toContain("weird_internal_code");
  });

  it("retryable=false면 재시도 버튼을 숨기고, 가능하면 멱등 키와 함께 POST한다", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/retry") ? Response.json({ job_id: "j" }, { status: 202 }) : Response.json(detail([])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ok = source({ status: "failed", title: "다시 가능", error_code: "lease_expired" });
    render(
      <WorkspaceShell
        initial={detail([ok, source({ status: "failed", title: "다시 불가", error_code: "scanned_pdf", latest_job: { id: "x", status: "failed", retryable: false } })])}
      />,
    );
    expect(screen.queryByRole("button", { name: "다시 불가 다시 시도" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 가능 다시 시도" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sources/${ok.id}/retry`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_.:-]{1,200}$/);
  });

  it("비활성 자료는 비활성 배지와 안내를 보여 준다", () => {
    render(<WorkspaceShell initial={detail([source({ title: "사라진 영상", unavailable_at: "2026-11-10T00:00:00Z" })])} />);
    expect(screen.getByText("비활성")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "사라진 영상 선택" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toMatch(/선택할 수 없고/);
  });

  it("전체 선택은 비활성 자료를 빼고 고른다", () => {
    render(
      <WorkspaceShell
        initial={detail([source({ title: "보통 자료" }), source({ title: "사라진 영상", unavailable_at: "2026-11-10T00:00:00Z" })])}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /전체 선택/ }));
    expect((screen.getByRole("checkbox", { name: "보통 자료 선택" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "사라진 영상 선택" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/전체 선택 \(1\/1\)/)).toBeTruthy();
  });

  it("삭제 확인 창을 취소하면 열기 버튼으로 포커스가 돌아간다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WorkspaceShell initial={detail([source({ title: "자료 가" })])} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "자료 가 선택" }));
    const trigger = screen.getByRole("button", { name: /선택 자료 삭제/ });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("유튜브 자료는 유튜브 배지가 붙고 youtube_disabled는 '유튜브 기능 준비 중'으로 보인다", () => {
    render(
      <WorkspaceShell
        initial={detail([
          source({
            source_type: "youtube",
            title: "강연 영상",
            status: "failed",
            error_code: "youtube_disabled",
            duration_seconds: 185,
            latest_job: { id: "y", status: "failed", retryable: false },
          }),
        ])}
      />,
    );
    expect(screen.getAllByText("유튜브").length).toBeGreaterThan(0);
    expect(screen.getByText("유튜브 기능 준비 중")).toBeTruthy();
    expect(screen.getByText(/03:05/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /다시 시도/ })).toBeNull();
  });

  it("선택 삭제는 확인 뒤 DELETE로 source_ids를 보낸다", async () => {
    const a = source({ title: "지울 자료" });
    const b = source({ title: "남길 자료" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? Response.json({ ok: true, deleted: 1 }) : Response.json(detail([b])),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={detail([a, b])} />);
    const del = screen.getByRole("button", { name: /선택 자료 삭제/ }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "지울 자료 선택" }));
    fireEvent.click(del);
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("지울 자료")).toBeNull());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT}/sources`);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ source_ids: [a.id] });
  });

  it("비활성 자료도 행의 삭제 버튼으로 하나씩 지울 수 있다(확인 뒤 DELETE)", async () => {
    const gone = source({ title: "사라진 영상", unavailable_at: "2026-11-10T00:00:00Z" });
    const keep = source({ title: "남길 자료" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? Response.json({ ok: true, deleted: 1 }) : Response.json(detail([keep])),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={detail([gone, keep])} />);
    fireEvent.click(screen.getByRole("button", { name: "사라진 영상 삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/사라진 영상/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("사라진 영상")).toBeNull());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT}/sources`);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ source_ids: [gone.id] });
  });

  it("행 삭제 확인을 취소하면 그 행의 삭제 버튼으로 포커스가 돌아간다", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WorkspaceShell initial={detail([source({ title: "자료 나", status: "processing" })])} />);
    const trigger = screen.getByRole("button", { name: "자료 나 삭제" });
    fireEvent.click(trigger);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("유형 필터로 목록을 좁힌다", () => {
    render(<WorkspaceShell initial={detail([source({ title: "문서" }), source({ title: "영상", source_type: "youtube" })])} />);
    const pdf = screen.getByRole("button", { name: "PDF" });
    fireEvent.click(pdf);
    expect(pdf.getAttribute("aria-pressed")).toBe("true");
    expect(pdf.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "전체" }).querySelector("svg")).toBeNull();
    expect(screen.getByText("문서")).toBeTruthy();
    expect(screen.queryByText("영상")).toBeNull();
  });

  it("<script>가 든 제목·요약은 텍스트로만 렌더된다", () => {
    const evil = "<script>window.__pwned = 1</script>";
    const { container } = render(<WorkspaceShell initial={detail([source({ title: evil })], `요약 ${evil}`)} />);
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
    expect(screen.getByText(`요약 ${evil}`)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("상태 폴링", () => {
  it("처리 중 자료가 있을 때만 5초에서 시작해 무변화면 30초까지 늘린다", async () => {
    vi.useFakeTimers();
    const processing = detail([source({ status: "processing" })]);
    const fetchMock = vi.fn(async () => Response.json(processing));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={processing} />);

    await act(() => vi.advanceTimersByTimeAsync(POLL_MIN_MS - 1));
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`/api/projects/${PROJECT}`);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([5_000, 10_000, 20_000, 30_000].map(nextPollDelay)).toEqual([10_000, 20_000, 30_000, POLL_MAX_MS]);
  });

  it("상태가 바뀌면 화면을 갱신하고, 모두 끝나면 폴링을 멈춘다", async () => {
    vi.useFakeTimers();
    const s = source({ status: "processing", title: "처리 자료" });
    const fetchMock = vi.fn(async () => Response.json(detail([{ ...s, status: "completed" }])));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={detail([s])} />);
    expect(screen.getByRole("status").textContent).toBe("");
    await act(() => vi.advanceTimersByTimeAsync(POLL_MIN_MS));
    expect(screen.getAllByText("완료").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toBe("처리 자료 처리 완료");
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("처리 중 자료가 없으면 부르지 않는다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={detail([source({ status: "failed", error_code: "no_chunks" })])} />);
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("탭이 숨겨지면 멈추고 다시 보이면 바로 읽는다", async () => {
    vi.useFakeTimers();
    const processing = detail([source({ status: "queued" })]);
    const fetchMock = vi.fn(async () => Response.json(processing));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceShell initial={processing} />);
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).not.toHaveBeenCalled();
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("유튜브 mm:ss 칩", () => {
  it("t_start를 mm:ss로 보여 주고 S-10 ?chunk=로 이동한다", () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const chunkId = "33333333-3333-4333-8333-333333333333";
    render(<TimestampChip sourceId={sourceId} chunkId={chunkId} tStart={185.7} />);
    const link = screen.getByRole("link", { name: "3분 5초 지점 원문 보기" });
    expect(link.textContent).toBe("03:05");
    expect(link.getAttribute("href")).toBe(`/sources/${sourceId}?chunk=${chunkId}`);
  });

  it("1시간 이상은 h:mm:ss, 잘못된 값은 00:00", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(Number.NaN)).toBe("00:00");
    expect(formatTimestamp(-3)).toBe("00:00");
  });
});

describe("ChatPanel 자리표시", () => {
  it("추천 질문을 텍스트로 보여 준다", () => {
    render(<ChatPanel projectId={PROJECT} suggestedQuestions={["<b>질문</b>"]} />);
    expect(screen.getByText("<b>질문</b>")).toBeTruthy();
  });
});

describe("비신뢰 텍스트 렌더 규칙", () => {
  it("워크스페이스·채팅·대시보드 코드는 dangerouslySetInnerHTML을 쓰지 않는다", () => {
    const root = join(process.cwd(), "src");
    const dirs = [join(root, "components/workspace"), join(root, "components/chat"), join(root, "app/(app)/dashboard"), join(root, "app/(app)/projects/[projectId]")];
    const files = dirs.flatMap((dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.tsx"))
        .map((e) => join(e.parentPath, e.name)),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toContain("dangerouslySetInnerHTML");
  });

  it("012b 화면 코드에는 Tailwind 임의값(w-[..] 등) 없이 토큰만 쓴다", () => {
    const root = join(process.cwd(), "src");
    const files = [
      ...readdirSync(join(root, "components/workspace"), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx"))
        .map((e) => join(e.parentPath, e.name)),
      join(root, "components/chat/ChatPanel.tsx"),
      join(root, "app/(app)/dashboard/page.tsx"),
      join(root, "app/(app)/dashboard/processing-sources.tsx"),
      join(root, "app/(app)/projects/[projectId]/page.tsx"),
    ];
    // data-[state=active]: 같은 변형 선택자는 값이 아니므로 뺀다
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/[\w-]+-\[[^\]]+\](?!:)/);
  });
});
