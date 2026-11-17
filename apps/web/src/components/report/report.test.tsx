import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceMeta } from "@/components/workspace/viewer/format";
import { CAPTURE_TEXT } from "@/components/youtube/capture/use-captures";
import type { CapturesResponse } from "@/components/youtube/capture/types";
import type { MomentsResponse } from "@/components/youtube/embed";
import { ReportShell } from "./report-shell";
import type { ReportFolder, SourceSummaryResponse } from "./types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const CHUNK = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const VIDEO = "dQw4w9WgXcQ";

const pdf: SourceMeta = {
  id: SOURCE_ID,
  project_id: "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22",
  source_type: "pdf",
  title: "시장 보고서.pdf",
  status: "completed",
  error_code: null,
  error_message: null,
  unavailable_at: null,
  original_url: null,
  video_id: null,
  channel_title: null,
  duration_seconds: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const youtube: SourceMeta = {
  ...pdf,
  source_type: "youtube",
  title: "강연 영상",
  original_url: `https://www.youtube.com/watch?v=${VIDEO}`,
  video_id: VIDEO,
  channel_title: "지식 채널",
  duration_seconds: 600,
};

const folder: ReportFolder = {
  id: pdf.project_id,
  name: "받은 자료",
  summary: "폴더 요약 본문",
  suggestedQuestions: ["핵심은 무엇인가요?"],
  sourceCount: 2,
};

const chunksBody = {
  items: [{ id: CHUNK, chunk_index: 0, content: "원문 첫 문단", locator: { page: 1, t_start: 30, t_end: 40 } }],
  next_cursor: null,
  has_before: false,
  around: "found",
  unavailable: false,
};

const moments = (over: Partial<Extract<MomentsResponse, { enabled: true }>> = {}): MomentsResponse => ({
  enabled: true,
  unavailable: false,
  items: [{ id: "m1", moment_index: 0, locator: { t_start: 125, t_end: 140 }, title: "도표", description: "막대그래프", citable: true }],
  summary: { sentences: [{ text: "영상 요약 문장", citations: [{ chunk_id: CHUNK, t_start: 42 }] }] },
  ...over,
});

const CHUNK2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
const pdfSummary: SourceSummaryResponse = {
  unavailable: false,
  summary: {
    sentences: [
      {
        text: "문서 요약 문장",
        citations: [
          { chunk_id: CHUNK, page: 1 },
          { chunk_id: CHUNK2, page: 3 },
          { chunk_id: CHUNK, page: 1 },
        ],
      },
    ],
  },
};

const NO_SUMMARY: SourceSummaryResponse = { unavailable: false, summary: null };

/** 가짜 시계에서 비동기 작업(fetch·setTimeout)을 ms만큼 진행한다 */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** URL별 응답 */
function stubRoutes(routes: {
  source?: SourceMeta | number;
  moments?: MomentsResponse | (() => MomentsResponse);
  summary?: SourceSummaryResponse | "error" | (() => SourceSummaryResponse);
  captures?: CapturesResponse;
}) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/chunks")) return Response.json(chunksBody);
    if (url.includes("/moments")) return Response.json(typeof routes.moments === "function" ? routes.moments() : (routes.moments ?? moments()));
    if (url.includes("/summary")) {
      if (routes.summary === "error") return new Response(null, { status: 500 });
      return Response.json(typeof routes.summary === "function" ? routes.summary() : (routes.summary ?? NO_SUMMARY));
    }
    if (url.includes("/captures")) return routes.captures ? Response.json(routes.captures) : new Response(null, { status: 422 });
    if (typeof routes.source === "number") return Response.json({ error: { code: "x", message: "x" } }, { status: routes.source });
    return Response.json({ source: routes.source ?? pdf });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calledUrls = (fn: ReturnType<typeof stubRoutes>) => fn.mock.calls.map((c) => String((c as unknown[])[0]));

function stubLayout(mode: "mobile" | "tablet" | "desktop") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("75rem") ? mode === "desktop" : mode !== "mobile",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const iframeSrc = () => document.querySelector("iframe")?.getAttribute("src") ?? null;

beforeEach(() => {
  refresh.mockReset();
  stubLayout("desktop");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("자료 결과 화면: 처리 상태", () => {
  it("처리 중이면 진행 상태를 보이고, 폴링으로 완료를 확인하면 서버 렌더를 새로 받는다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ source: { ...pdf, status: "completed" } });
    render(<ReportShell initialSource={{ ...pdf, status: "processing" }} folder={folder} initialChunkId={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "시장 보고서.pdf" })).toBeTruthy();
    expect(screen.getByText("자료를 분석하고 있습니다")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "목차" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calledUrls(fetchMock)[0]).toBe(`/api/sources/${SOURCE_ID}`);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/처리가 끝났습니다/)).toBeTruthy();
  });

  it("실패한 자료는 오류 문구와 자료 목록 링크를 보이고 폴링하지 않는다", () => {
    const fetchMock = stubRoutes({});
    render(<ReportShell initialSource={{ ...pdf, status: "failed", error_message: "PDF를 읽지 못했습니다." }} folder={folder} initialChunkId={null} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("PDF를 읽지 못했습니다.")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "자료 목록으로" }).getAttribute("href")).toBe("/sources");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("폴링 중 401이면 폴링을 멈추고 로그인 안내를 보인다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ source: 401 });
    render(<ReportShell initialSource={{ ...pdf, status: "processing" }} folder={folder} initialChunkId={null} />);
    await advance(5_000);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("다시 로그인해 주세요")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "로그인" }).getAttribute("href")).toBe(`/login?next=${encodeURIComponent(`/sources/${SOURCE_ID}`)}`);
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("폴링 중 404이면 폴링을 멈추고 자료를 찾을 수 없다고 안내한다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ source: 404 });
    render(<ReportShell initialSource={{ ...pdf, status: "queued" }} folder={folder} initialChunkId={null} />);
    await advance(5_000);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("자료를 찾을 수 없습니다")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "자료 목록으로" })).toBeTruthy();
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("비활성 자료는 요약·원문 없이 안내만 보인다", () => {
    stubRoutes({});
    render(<ReportShell initialSource={{ ...youtube, unavailable_at: "2026-11-02T00:00:00Z" }} folder={folder} initialChunkId={null} youtubeEnabled />);
    expect(screen.getByText("원본 영상을 더 이상 볼 수 없습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원문 보기" })).toBeNull();
  });
});

describe("자료 결과 화면: PDF 리포트", () => {
  it("번호 목차·세리프 자료 요약(p.N 칩)·자료 카드·채팅(준비 중)을 보이고 원문은 닫힌 채 시작한다", async () => {
    const fetchMock = stubRoutes({ summary: pdfSummary });
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    const toc = screen.getByRole("navigation", { name: "목차" });
    expect(within(toc).getByText("01")).toBeTruthy();
    expect(within(toc).getByRole("link", { name: /요약/ }).getAttribute("aria-current")).toBe("location");
    expect((await screen.findByText("문서 요약 문장")).className).toContain("font-serif");
    // 같은 쪽은 칩 하나
    expect(screen.getAllByRole("button", { name: /^p\.\d+/ }).map((b) => b.textContent)).toEqual(["p.1 원문 보기", "p.3 원문 보기"]);
    expect(screen.queryByText("폴더 요약 본문")).toBeNull();
    expect(screen.getByRole("link", { name: "받은 자료" }).getAttribute("href")).toBe(`/sources?folder=${folder.id}`);
    expect(within(screen.getByTestId("chat-column")).getByText(/준비 중입니다/)).toBeTruthy();
    expect(screen.queryByTestId("original-card")).toBeNull();
    expect(calledUrls(fetchMock)).toEqual([`/api/sources/${SOURCE_ID}/summary`]);
  });

  it("p.N 칩을 누르면 원문 카드를 그 청크(쪽)에서 연다", async () => {
    const fetchMock = stubRoutes({ summary: pdfSummary });
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /^p\.3/ }));
    const card = screen.getByTestId("original-card");
    await within(card).findByText("원문 첫 문단");
    expect(calledUrls(fetchMock).some((u) => u.startsWith(`/api/sources/${SOURCE_ID}/chunks`) && u.includes(`chunk_id=${CHUNK2}`))).toBe(true);
  });

  it("자료 요약을 불러오지 못하면 다시 시도할 수 있다", async () => {
    stubRoutes({ summary: "error" });
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    expect(await screen.findByText("요약을 불러오지 못했습니다")).toBeTruthy();
  });

  it("'원문 보기'로 떠 있는 원문 카드를 열어 청크를 읽고, Esc로 닫는다", async () => {
    const fetchMock = stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "원문 보기" }));
    const card = screen.getByTestId("original-card");
    expect(await within(card).findByText("원문 첫 문단")).toBeTruthy();
    expect(calledUrls(fetchMock).some((u) => u.startsWith(`/api/sources/${SOURCE_ID}/chunks`))).toBe(true);
    fireEvent.keyDown(card, { key: "Escape" });
    expect(screen.queryByTestId("original-card")).toBeNull();
  });

  it("O 키로 원문 카드를 열고 닫으며, 입력 중에는 무시한다", () => {
    stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.keyDown(window, { key: "o" });
    expect(screen.getByTestId("original-card")).toBeTruthy();
    fireEvent.keyDown(window, { key: "O" });
    expect(screen.queryByTestId("original-card")).toBeNull();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "o" });
    expect(screen.queryByTestId("original-card")).toBeNull();
    input.remove();
  });

  it("데스크톱에서 고정하면 원문 | 리포트 | 채팅 3단이 되고 목차 열이 빠진다", () => {
    stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "원문 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "원문을 왼쪽에 고정" }));
    const grid = screen.getByTestId("report-grid");
    expect(grid.getAttribute("data-layout")).toBe("pinned");
    expect(within(grid).getByTestId("original-card").getAttribute("data-pinned")).toBe("true");
    expect(screen.queryByTestId("toc-column")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "원문 고정 풀기" }));
    expect(screen.getByTestId("report-grid").getAttribute("data-layout")).toBe("default");
  });

  it("태블릿에서는 고정 상태여도 떠 있는 카드로 둔다", () => {
    stubLayout("tablet");
    stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "원문 보기" }));
    expect(screen.getByTestId("report-grid").getAttribute("data-layout")).toBe("default");
    expect(screen.getByTestId("original-card").getAttribute("data-pinned")).toBeNull();
  });

  it("?chunk로 들어오면 원문 카드를 연 채로 시작한다", async () => {
    stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={CHUNK} />);
    expect(await within(screen.getByTestId("original-card")).findByText("원문 첫 문단")).toBeTruthy();
  });

  it("완료 직후 요약이 아직 없으면 '요약을 만드는 중'으로 다시 읽고, 저장되면 보인다(폴더 요약 대체 없음)", async () => {
    vi.useFakeTimers();
    let ready = false;
    const fetchMock = stubRoutes({ summary: () => (ready ? pdfSummary : NO_SUMMARY) });
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await advance(0);
    expect(screen.getByText(/요약을 만드는 중입니다/)).toBeTruthy();
    expect(screen.queryByText("폴더 요약 본문")).toBeNull();
    await advance(3_000);
    expect(calledUrls(fetchMock).filter((u) => u.endsWith("/summary"))).toHaveLength(2);
    ready = true;
    await advance(6_000);
    expect(screen.getByText("문서 요약 문장")).toBeTruthy();
    expect(screen.queryByText(/요약을 만드는 중입니다/)).toBeNull();
    await advance(60_000);
    expect(calledUrls(fetchMock).filter((u) => u.endsWith("/summary"))).toHaveLength(3);
  });

  it("2분이 지나도 요약이 없으면 다시 읽기를 멈추고 빈 상태와 '다시 시도'를 보인다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({});
    render(<ReportShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await advance(0);
    await advance(125_000);
    expect(screen.getByText("아직 요약이 없습니다.")).toBeTruthy();
    expect(screen.queryByText("폴더 요약 본문")).toBeNull();
    const calls = calledUrls(fetchMock).filter((u) => u.endsWith("/summary")).length;
    // 3·6·10초 뒤 10초 간격, 2분 안에서만
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThanOrEqual(15);
    await advance(60_000);
    expect(calledUrls(fetchMock).filter((u) => u.endsWith("/summary"))).toHaveLength(calls);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await advance(0);
    expect(screen.getByText(/요약을 만드는 중입니다/)).toBeTruthy();
    expect(calledUrls(fetchMock).filter((u) => u.endsWith("/summary"))).toHaveLength(calls + 1);
  });
});

describe("자료 결과 화면: 유튜브 리포트", () => {
  it("영상 요약·장면 카드를 리포트에, 플레이어는 원문 카드에 두고 장면을 누르면 원문을 열어 그 시각부터 재생한다", async () => {
    stubRoutes({});
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    expect(await screen.findByText("영상 요약 문장")).toBeTruthy();
    const toc = screen.getByRole("navigation", { name: "목차" });
    expect(within(toc).getByRole("link", { name: /장면 카드/ })).toBeTruthy();
    expect(iframeSrc()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /02:05/ }));
    const card = screen.getByTestId("original-card");
    await within(card).findByText("원문 첫 문단");
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=125&autoplay=1`);

    fireEvent.click(screen.getByRole("button", { name: /00:42/ }));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=42&autoplay=1`);
  });

  it("원문 카드를 먼저 열면 플레이어는 인용 청크 시각에서 멈춘 채로 열린다", async () => {
    stubRoutes({});
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={CHUNK} youtubeEnabled />);
    await within(screen.getByTestId("original-card")).findByText("원문 첫 문단");
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=30`);
  });

  it("유튜브 플래그가 꺼지면 /moments·/summary를 부르지 않고 '유튜브 기능 준비 중'만 보인다(폴더 요약 대체 없음)", () => {
    const fetchMock = stubRoutes({});
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} />);
    expect(screen.getByText(/유튜브 기능 준비 중/)).toBeTruthy();
    expect(screen.queryByText("폴더 요약 본문")).toBeNull();
    expect(calledUrls(fetchMock).some((u) => u.includes("/moments") || u.includes("/summary"))).toBe(false);
  });

  it("영상 요약이 아직 없으면 장면 카드는 보이고 요약은 '만드는 중'으로 다시 읽다가 저장되면 보인다", async () => {
    vi.useFakeTimers();
    let ready = false;
    stubRoutes({ moments: () => moments(ready ? {} : { summary: null }) });
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    await advance(0);
    expect(screen.getByText(/요약을 만드는 중입니다/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /장면 카드/ })).toBeTruthy();
    ready = true;
    await advance(3_000);
    expect(screen.getByText("영상 요약 문장")).toBeTruthy();
  });

  it("영상 요약이 2분 안에 생기지 않으면 빈 상태를 보인다(폴더 요약 대체 없음)", async () => {
    vi.useFakeTimers();
    stubRoutes({ moments: moments({ summary: null }) });
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    await advance(0);
    await advance(125_000);
    expect(screen.getByText("아직 요약이 없습니다.")).toBeTruthy();
    expect(screen.queryByText("폴더 요약 본문")).toBeNull();
  });

  it("서버 스위치가 꺼져 있으면({enabled:false}) 장면 카드 장이 없다", async () => {
    stubRoutes({ moments: { enabled: false } });
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    expect(await screen.findByText(/유튜브 기능 준비 중/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /장면 카드/ })).toBeNull();
  });
});

describe("자료 결과 화면: 원문이 닫힌 상태의 캡처", () => {
  const capturesOk: CapturesResponse = { unavailable: false, limit: 20, channel_title: "지식 채널", items: [] };

  function stubCaptureEnv() {
    vi.stubGlobal("CropTarget", { fromElement: vi.fn(async () => ({})) });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("원문 카드를 열고 플레이어가 준비되면 탭 공유를 요청한다", async () => {
    stubCaptureEnv();
    stubRoutes({ captures: capturesOk });
    render(<ReportShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    expect(screen.queryByTestId("original-card")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /도표 장면 화면 캡처/ }));
    expect(await screen.findByText(CAPTURE_TEXT.denied)).toBeTruthy();
    expect(screen.getByTestId("original-card")).toBeTruthy();
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=125&autoplay=1`);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it("플레이어를 띄울 수 없으면 탭 공유를 요청하지 않고 안내한다", async () => {
    stubCaptureEnv();
    stubRoutes({ captures: capturesOk });
    render(<ReportShell initialSource={{ ...youtube, video_id: null }} folder={folder} initialChunkId={null} youtubeEnabled />);
    fireEvent.click(await screen.findByRole("button", { name: /도표 장면 화면 캡처/ }));
    expect(await screen.findByText(CAPTURE_TEXT.noTarget, undefined, { timeout: 4_000 })).toBeTruthy();
    expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  });
});

describe("자료 결과 화면 HTML 주입 금지", () => {
  it("report 컴포넌트에 dangerouslySetInnerHTML이 없다", () => {
    const dir = join(process.cwd(), "src/components/report");
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test.") && statSync(join(dir, n)).isFile());
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) expect(readFileSync(join(dir, name), "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});
