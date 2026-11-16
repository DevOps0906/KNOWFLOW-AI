import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubePanel, type MomentsPayload } from "../youtube-panel";
import { cropRect } from "./capture-frame";
import { CAPTURE_STATUS_MESSAGES } from "./use-captures";

const VIDEO_ID = "dQw4w9WgXcQ";
const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";

const moments: MomentsPayload = {
  enabled: true,
  unavailable: false,
  moments: [{ id: "m1", locator: { t_start: 125, t_end: 190 }, title: "칠판 그림", description: "그래프", citable: true }],
  summary: null,
};

function stubFetch() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/moments")) return Response.json(moments);
    if (url.endsWith("/captures") && (!init || !init.method || init.method === "GET")) {
      return Response.json({ enabled: true, limit: 20, captures: [] });
    }
    return Response.json({ capture_id: "c1" }, { status: 201 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query.includes("75rem"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function stubDisplayMedia(impl: () => Promise<MediaStream>) {
  const getDisplayMedia = vi.fn(impl);
  Object.defineProperty(navigator, "mediaDevices", { value: { getDisplayMedia }, configurable: true });
  return getDisplayMedia;
}

const posts = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls.filter(([, init]) => init?.method === "POST");

const panel = (captureEnabled = true) => (
  <YoutubePanel sourceId={SOURCE_ID} videoId={VIDEO_ID} title="강연" originalUrl={null} initialStart={null} captureEnabled={captureEnabled} />
);

beforeEach(() => {
  stubDisplayMedia(async () => {
    throw new DOMException("denied", "NotAllowedError");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("L1 탭 캡처 진입(task-030)", () => {
  it("데스크톱 + 캡처 플래그면 장면 카드에 캡처 버튼과 캡처 목록이 보인다", async () => {
    stubViewport(true);
    stubFetch();
    render(panel());
    expect(await screen.findByRole("button", { name: /화면 캡처$/ })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "내 화면 캡처" })).toBeTruthy();
  });

  it("모바일·태블릿에서는 진입을 숨기고 캡처 API를 부르지 않는다", async () => {
    stubViewport(false);
    const fetchMock = stubFetch();
    render(panel());
    await screen.findByText("칠판 그림");
    expect(screen.queryByRole("button", { name: /화면 캡처$/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "내 화면 캡처" })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/captures"))).toBe(false);
  });

  it("캡처 플래그가 꺼지면 데스크톱에서도 숨긴다", async () => {
    stubViewport(true);
    stubFetch();
    render(panel(false));
    await screen.findByText("칠판 그림");
    expect(screen.queryByRole("button", { name: /화면 캡처$/ })).toBeNull();
  });

  it("탭 공유 API가 없는 브라우저는 숨긴다", async () => {
    stubViewport(true);
    stubFetch();
    Reflect.deleteProperty(navigator, "mediaDevices");
    render(panel());
    await screen.findByText("칠판 그림");
    expect(screen.queryByRole("button", { name: /화면 캡처$/ })).toBeNull();
  });
});

describe("탭 공유 거부", () => {
  it("사용자가 탭 공유를 거부하면 저장 요청을 보내지 않고 안내한다", async () => {
    stubViewport(true);
    const fetchMock = stubFetch();
    const getDisplayMedia = stubDisplayMedia(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    render(panel());
    fireEvent.click(await screen.findByRole("button", { name: /화면 캡처$/ }));
    expect(await screen.findByText(CAPTURE_STATUS_MESSAGES.denied)).toBeTruthy();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(posts(fetchMock)).toHaveLength(0);
    // 그 시각으로 이동했다(플레이어 start)
    expect(new URL(document.querySelector("iframe")!.getAttribute("src")!).searchParams.get("start")).toBe("125");
  });
});

describe("cropRect", () => {
  it("이 탭(같은 비율)이면 플레이어 영역만, 다른 비율이면 전체", () => {
    const target = { left: 100, top: 50, width: 640, height: 360 };
    expect(cropRect({ width: 2560, height: 1440 }, { width: 1280, height: 720 }, target)).toEqual({ x: 200, y: 100, width: 1280, height: 720 });
    expect(cropRect({ width: 1920, height: 1200 }, { width: 1280, height: 720 }, target)).toEqual({ x: 0, y: 0, width: 1920, height: 1200 });
    expect(cropRect({ width: 1280, height: 720 }, { width: 1280, height: 720 }, null)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
