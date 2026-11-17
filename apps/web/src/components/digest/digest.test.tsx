import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportFolder } from "@/components/report/types";
import type { SourceMeta } from "@/components/workspace/viewer/format";
import { citationLabel, formatClock } from "./citation-chips";
import { splitFirstSentence } from "./digest-article";
import { DigestShell } from "./digest-shell";
import type { CapturesResponse } from "@/components/youtube/capture/types";
import type { MomentsResponse } from "@/components/youtube/embed";
import type { DigestCitation, DigestResponse } from "./types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const CHUNK = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const CHUNK2 = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";
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

const folder: ReportFolder = { id: pdf.project_id, name: "받은 자료", summary: null, suggestedQuestions: [], sourceCount: 1 };

const chunksBody = {
  items: [{ id: CHUNK, chunk_index: 0, content: "원문 첫 문단", locator: { page: 1, t_start: 30, t_end: 40 } }],
  next_cursor: null,
  has_before: false,
  around: "found",
  unavailable: false,
};

const momentsBody: MomentsResponse = {
  enabled: true,
  unavailable: false,
  items: [{ id: "m1", moment_index: 0, locator: { t_start: 125, t_end: 140 }, title: "도표", description: "막대그래프", citable: true }],
  summary: null,
};
const capturesBody: CapturesResponse = { unavailable: false, limit: 20, channel_title: "지식 채널", items: [] };

/** 캡처 L1 진입 조건(데스크톱 · getDisplayMedia · CropTarget) */
function stubCaptureEnvironment() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("CropTarget", { fromElement: vi.fn(async () => ({})) });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: vi.fn() } });
}

const pageCite = (chunk_id: string, page: number) => ({ chunk_id, t_start: null, page });

const ready = (cite: DigestCitation = pageCite(CHUNK2, 3)): DigestResponse => ({
  unavailable: false,
  status: "ready",
  digest: {
    version: 1,
    title: "시장 보고서 요약",
    glance: [{ text: "RAG가 검색 품질을 좌우한다", details: ["하위 점 하나"], citations: [cite] }],
    terms: [{ term: "RAG", desc: "검색 증강 생성", citations: [pageCite(CHUNK, 1)] }],
    chapters: [
      {
        title: "시장 규모",
        intro: "도입 문단",
        citations: [pageCite(CHUNK, 1)],
        points: [{ text: "첫 문장이다. 나머지 설명.", citations: [pageCite(CHUNK, 1)], subpoints: [{ text: "하위 요점", citations: [pageCite(CHUNK, 2)] }] }],
      },
    ],
  },
});

/** URL별 응답. digest가 숫자면 그 상태 코드 */
function stubRoutes(routes: { source?: SourceMeta | number; digest?: DigestResponse | number }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/chunks")) return Response.json(chunksBody);
    if (url.includes("/moments")) return Response.json(momentsBody);
    if (url.includes("/captures")) return Response.json(capturesBody);
    if (url.includes("/digest")) {
      const d = routes.digest ?? ready();
      return typeof d === "number" ? new Response(null, { status: d }) : Response.json(d);
    }
    if (typeof routes.source === "number") return Response.json({ error: { code: "x", message: "x" } }, { status: routes.source });
    return Response.json({ source: routes.source ?? pdf });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calledUrls = (fn: ReturnType<typeof stubRoutes>) => fn.mock.calls.map((c) => String((c as unknown[])[0]));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("자료 다이제스트 화면", () => {
  it("전체 높이 화면에 홈 알약·제목·칩 줄을 보인다", async () => {
    stubRoutes({});
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    expect(screen.getByTestId("digest-screen").className).toContain("h-dvh");
    expect(screen.getByRole("link", { name: "홈" }).getAttribute("href")).toBe("/sources");
    expect(await screen.findByRole("heading", { level: 1, name: "시장 보고서 요약" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "받은 자료" }).getAttribute("href")).toBe(`/sources?folder=${folder.id}`);
    expect((screen.getByRole("textbox", { name: /준비 중/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("핵심 모드는 한눈에 보기·핵심 용어만, 딥 리서치는 장까지 보이고 목차도 따라 바뀐다", async () => {
    stubRoutes({});
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    expect(await screen.findByRole("heading", { name: "한눈에 보기" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "핵심 용어" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /시장 규모/ })).toBeNull();
    const toc = screen.getAllByRole("navigation", { name: "목차" })[0];
    expect(within(toc).queryByText("시장 규모")).toBeNull();

    const group = screen.getAllByRole("group", { name: "보기 범위" })[0];
    fireEvent.click(within(group).getByRole("button", { name: "딥 리서치" }));
    expect(within(group).getByRole("button", { name: "딥 리서치" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: /시장 규모/ })).toBeTruthy();
    expect(within(toc).getByText("시장 규모")).toBeTruthy();
    // 요점 첫 문장은 굵게, 하위 요점 칩 p.2
    expect(screen.getByText("첫 문장이다.").tagName).toBe("STRONG");
    expect(screen.getByRole("button", { name: /^p\.2/ })).toBeTruthy();
  });

  it("본문에서 핵심 용어와 일치하는 구절은 점선 밑줄이고 설명을 title로 보인다", async () => {
    stubRoutes({});
    const { container } = render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await screen.findByRole("heading", { name: "한눈에 보기" });
    const term = container.querySelector("[data-term]");
    expect(term?.textContent).toBe("RAG");
    expect(term?.getAttribute("title")).toBe("검색 증강 생성");
    expect(term?.className).toContain("decoration-dotted");
  });

  it("PDF 인용 칩(p.N)을 누르면 원문 카드를 그 청크에서 연다", async () => {
    const fetchMock = stubRoutes({});
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /^p\.3/ }));
    expect(screen.getByTestId("original-card")).toBeTruthy();
    await screen.findByText("원문 첫 문단");
    expect(calledUrls(fetchMock).some((u) => u.includes("/chunks") && u.includes(`chunk_id=${CHUNK2}`))).toBe(true);
  });

  it("영상 인용 칩(m:ss)을 누르면 원문 카드 플레이어를 그 시각부터 재생한다", async () => {
    stubRoutes({ source: youtube, digest: ready({ chunk_id: CHUNK, t_start: 125, page: null }) });
    render(<DigestShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    fireEvent.click(await screen.findByRole("button", { name: /^2:05/ }));
    expect(screen.getByTestId("original-card")).toBeTruthy();
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const src = document.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("start=125");
    expect(src).toContain("autoplay=1");
  });

  it("영상 원문 카드는 유튜브 패널(장면 카드·캡처 L1)로 그린다", async () => {
    stubCaptureEnvironment();
    const fetchMock = stubRoutes({ source: youtube, digest: ready({ chunk_id: CHUNK, t_start: 125, page: null }) });
    render(<DigestShell initialSource={youtube} folder={folder} initialChunkId={null} youtubeEnabled />);
    fireEvent.click(await screen.findByRole("button", { name: /^2:05/ }));
    const card = screen.getByTestId("original-card");
    expect(await within(card).findByRole("button", { name: "도표 장면 화면 캡처" })).toBeTruthy();
    expect(calledUrls(fetchMock).some((u) => u.includes("/captures"))).toBe(true);
  });

  it("유튜브 플래그가 꺼져 있으면 원문 카드에 준비 중 안내만 보인다", async () => {
    const fetchMock = stubRoutes({ source: youtube, digest: ready({ chunk_id: CHUNK, t_start: 125, page: null }) });
    render(<DigestShell initialSource={youtube} folder={folder} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /^2:05/ }));
    expect(await within(screen.getByTestId("original-card")).findByText(/유튜브 기능 준비 중/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(calledUrls(fetchMock).some((u) => u.includes("/moments") || u.includes("/captures"))).toBe(false);
  });

  it("하단 원본 알약으로 원문 카드를 연다·닫는다", async () => {
    stubRoutes({});
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await screen.findByRole("heading", { name: "한눈에 보기" });
    fireEvent.click(screen.getByRole("button", { name: "원본" }));
    expect(screen.getByTestId("original-card")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "원본" }));
    expect(screen.queryByTestId("original-card")).toBeNull();
  });
});

describe("자료 다이제스트 화면: 빈·처리 중 상태", () => {
  it("pending이면 요약을 만드는 중으로 다시 읽고, 시간이 지나면 빈 상태와 다시 시도를 보인다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ digest: { unavailable: false, status: "pending", digest: null } });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await advance(0);
    expect(screen.getByText(/요약을 만드는 중입니다/)).toBeTruthy();
    await advance(130_000);
    expect(screen.queryByText(/요약을 만드는 중입니다/)).toBeNull();
    expect(screen.getByText("아직 요약이 없습니다.")).toBeTruthy();
    const before = calledUrls(fetchMock).filter((u) => u.includes("/digest")).length;
    expect(before).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await advance(0);
    expect(calledUrls(fetchMock).filter((u) => u.includes("/digest")).length).toBe(before + 1);
  });

  it("none이면 기다리지 않고 바로 빈 상태를 보인다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ digest: { unavailable: false, status: "none", digest: null } });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await advance(0);
    expect(screen.getByText("아직 요약이 없습니다.")).toBeTruthy();
    expect(screen.queryByText(/요약을 만드는 중입니다/)).toBeNull();
    await advance(30_000);
    expect(calledUrls(fetchMock).filter((u) => u.includes("/digest"))).toHaveLength(1);
  });

  it("failed면 기다리지 않고 요약을 만들지 못했다고 안내한다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ digest: { unavailable: false, status: "failed", digest: null } });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    await advance(0);
    expect(within(screen.getByRole("alert")).getByText("요약을 만들지 못했습니다")).toBeTruthy();
    await advance(30_000);
    expect(calledUrls(fetchMock).filter((u) => u.includes("/digest"))).toHaveLength(1);
  });

  it("다이제스트 조회가 404면 자료를 찾을 수 없다고 안내하고 자료 목록 링크를 보인다", async () => {
    const fetchMock = stubRoutes({ digest: 404 });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("자료를 찾을 수 없습니다")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "자료 목록으로" }).getAttribute("href")).toBe("/sources");
    expect(calledUrls(fetchMock).filter((u) => u.includes("/digest"))).toHaveLength(1);
  });

  it("unavailable이면 숨김 안내를 보인다", async () => {
    stubRoutes({ digest: { unavailable: true, status: "none", digest: null } });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    expect(await screen.findByText("원본을 더 이상 볼 수 없습니다")).toBeTruthy();
  });

  it("다이제스트 조회가 401이면 다시 읽지 않고 로그인 안내를 보인다", async () => {
    const fetchMock = stubRoutes({ digest: 401 });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "로그인" }).getAttribute("href")).toBe(`/login?next=${encodeURIComponent(`/sources/${SOURCE_ID}`)}`);
    expect(calledUrls(fetchMock).filter((u) => u.includes("/digest"))).toHaveLength(1);
  });

  it("다이제스트 조회가 500이면 오류와 다시 시도를 보인다", async () => {
    stubRoutes({ digest: 500 });
    render(<DigestShell initialSource={pdf} folder={folder} initialChunkId={null} />);
    expect(await screen.findByText("요약을 불러오지 못했습니다")).toBeTruthy();
  });

  it("처리 중이면 상태 카드만 보이고 다이제스트를 부르지 않으며, 폴링으로 완료되면 서버 렌더를 새로 받는다", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRoutes({ source: pdf });
    render(<DigestShell initialSource={{ ...pdf, status: "processing" }} folder={folder} initialChunkId={null} />);
    expect(screen.getByText("자료를 분석하고 있습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원본" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(5_000);
    // 완료를 확인한 뒤에야 다이제스트를 읽는다
    expect(calledUrls(fetchMock)[0]).toBe(`/api/sources/${SOURCE_ID}`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("폴링 중 401이면 폴링을 멈추고 로그인 안내를 보인다", async () => {
    vi.useFakeTimers();
    stubRoutes({ source: 401 });
    render(<DigestShell initialSource={{ ...pdf, status: "processing" }} folder={folder} initialChunkId={null} />);
    await advance(5_000);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("다시 로그인해 주세요")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "로그인" }).getAttribute("href")).toBe(`/login?next=${encodeURIComponent(`/sources/${SOURCE_ID}`)}`);
  });
});

describe("다이제스트 보조 함수", () => {
  it("인용 칩 글자: 영상 m:ss, PDF p.N, 둘 다 없으면 null", () => {
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(citationLabel({ chunk_id: CHUNK, t_start: 5, page: null })).toBe("0:05");
    expect(citationLabel(pageCite(CHUNK, 4))).toBe("p.4");
    expect(citationLabel({ chunk_id: CHUNK, t_start: null, page: null })).toBeNull();
  });

  it("요점의 첫 문장을 나눈다", () => {
    expect(splitFirstSentence("가. 나 다.")).toEqual(["가.", "나 다."]);
    expect(splitFirstSentence("마침표 없음")).toEqual(["마침표 없음", ""]);
  });
});
