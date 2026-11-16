import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MomentsResponse } from "../embed";
import { YoutubePanel } from "../youtube-panel";
import { CapturePreviewDialog } from "./capture-ui";
import { captureSupported } from "./grab-frame";
import type { CaptureItem, CapturesResponse } from "./types";

// task-030 화면: 탭 공유 거부·다른 화면 선택 시 저장 없음, 20장이면 버튼 잠금, 모바일·태블릿·기능 미지원이면 진입 숨김.

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const MOMENT_ID = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

const moments: MomentsResponse = {
  enabled: true,
  unavailable: false,
  summary: null,
  items: [{ id: MOMENT_ID, moment_index: 0, locator: { t_start: 10, t_end: 20 }, title: "도입", description: "설명", citable: true }],
};

const capture = (i: number): CaptureItem => ({
  id: `c-${i}`,
  moment_id: MOMENT_ID,
  t_seconds: 10 + i,
  url: `https://storage.test/c-${i}.webp`,
  source_url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=${10 + i}s`,
  created_at: "2026-11-17T00:00:00Z",
});

function stubFetch(captures: CapturesResponse | Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/moments")) return Response.json(moments);
    if (url.includes("/captures") && (!init?.method || init.method === "GET")) {
      return captures instanceof Response ? captures : Response.json(captures);
    }
    return Response.json({ id: "new" }, { status: 201 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function stubEnvironment(opts: { desktop?: boolean; crop?: boolean; getDisplayMedia?: () => Promise<MediaStream> } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: opts.desktop ?? true, media: query, addEventListener() {}, removeEventListener() {} }));
  if (opts.crop ?? true) vi.stubGlobal("CropTarget", { fromElement: vi.fn(async () => ({})) });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: vi.fn(opts.getDisplayMedia ?? (async () => Promise.reject(new DOMException("denied", "NotAllowedError")))) },
  });
}

const empty: CapturesResponse = { unavailable: false, limit: 20, channel_title: "채널", items: [] };

const posts = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls.filter(([, init]) => init?.method === "POST");

function renderPanel() {
  return render(<YoutubePanel sourceId={SOURCE_ID} videoId="dQw4w9WgXcQ" title="강연" originalUrl={null} startSeconds={null} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("진입 조건", () => {
  it("데스크톱 + getDisplayMedia + CropTarget일 때만 지원", () => {
    stubEnvironment();
    expect(captureSupported()).toBe(true);
    stubEnvironment({ desktop: false });
    expect(captureSupported()).toBe(false);
  });

  it("모바일·태블릿(1200 미만)에서는 캡처 목록을 부르지 않고 버튼도 없다", async () => {
    stubEnvironment({ desktop: false });
    const fn = stubFetch(empty);
    renderPanel();
    await screen.findByText("도입");
    expect(screen.queryByRole("button", { name: /화면 캡처/ })).toBeNull();
    expect(fn.mock.calls.some(([u]) => String(u).includes("/captures"))).toBe(false);
  });

  it("CropTarget·RestrictionTarget이 없는 브라우저도 숨긴다", async () => {
    stubEnvironment({ crop: false });
    const fn = stubFetch(empty);
    renderPanel();
    await screen.findByText("도입");
    expect(screen.queryByRole("button", { name: /화면 캡처/ })).toBeNull();
    expect(fn.mock.calls.some(([u]) => String(u).includes("/captures"))).toBe(false);
  });

  it("서버 스위치가 꺼져 있으면(422) 진입을 숨긴다", async () => {
    stubEnvironment();
    stubFetch(Response.json({ error: { code: "capture_disabled", message: "지원 예정" } }, { status: 422 }));
    renderPanel();
    await screen.findByText("도입");
    await waitFor(() => expect(screen.queryByRole("button", { name: /화면 캡처/ })).toBeNull());
    expect(screen.queryByText(/장면 캡처/)).toBeNull();
  });
});

describe("캡처 흐름", () => {
  it("탭 공유를 거부하면 저장 요청을 보내지 않고 안내만 보인다", async () => {
    stubEnvironment();
    const fn = stubFetch(empty);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /도입 장면 화면 캡처/ }));
    expect(await screen.findByText("탭 공유를 승인하지 않아 캡처하지 않았습니다.")).toBeTruthy();
    expect(posts(fn)).toHaveLength(0);
  });

  it("캡처 버튼은 플레이어를 그 카드 t_start로 옮기고(자동 재생) 탭 공유를 요청한다", async () => {
    stubEnvironment();
    stubFetch(empty);
    const { container } = renderPanel();
    expect(container.querySelector("iframe")?.getAttribute("src")).not.toContain("start=");
    fireEvent.click(await screen.findByRole("button", { name: /도입 장면 화면 캡처/ }));
    await screen.findByText("탭 공유를 승인하지 않아 캡처하지 않았습니다.");
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10&autoplay=1");
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it("탭이 아닌 화면을 고르면 트랙을 멈추고 저장하지 않는다", async () => {
    const stop = vi.fn();
    const track = { stop, getSettings: () => ({ displaySurface: "monitor" }) };
    stubEnvironment({
      getDisplayMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream,
    });
    const fn = stubFetch(empty);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /도입 장면 화면 캡처/ }));
    expect(await screen.findByText("이 탭을 공유해야 캡처할 수 있습니다. 다시 시도해 주세요.")).toBeTruthy();
    expect(stop).toHaveBeenCalled();
    expect(posts(fn)).toHaveLength(0);
  });

  it("20장이면 캡처 버튼이 잠긴다(21장째 진입 차단)", async () => {
    stubEnvironment();
    stubFetch({ ...empty, items: Array.from({ length: 20 }, (_, i) => capture(i)) });
    renderPanel();
    const button = await screen.findByRole("button", { name: /도입 장면 화면 캡처/ });
    await waitFor(() => expect(button.textContent).toContain("캡처 한도 도달"));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("장면 캡처 (20/20)")).toBeTruthy();
  });

  it("목록은 시각·채널명·원본 링크를 표기한다", async () => {
    stubEnvironment();
    stubFetch({ ...empty, items: [capture(5)] });
    renderPanel();
    const link = await screen.findByRole("link", { name: /원본 영상/ });
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15s");
    expect(screen.getByText(/채널/)).toBeTruthy();
  });
});

describe("미리보기 확인", () => {
  it("카드 시각(mm:ss) 장면이 맞는지 확인하라고 안내하고, 확인 버튼을 눌러야 저장한다", () => {
    const onSave = vi.fn();
    const preview = { moment: moments.enabled ? moments.items[0]! : (undefined as never), blob: new Blob(["x"], { type: "image/webp" }), idempotencyKey: "k" };
    render(<CapturePreviewDialog preview={preview} busy={false} message={null} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByText(/00:10 장면이 맞는지 확인하세요/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "맞습니다, 저장" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
