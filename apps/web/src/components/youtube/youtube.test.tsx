import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbedPlayer } from "./embed-player";
import { MomentCards } from "./moment-cards";
import { cleanUntrustedText, embedUrl } from "./text";
import { VideoSummary } from "./video-summary";
import { YoutubePanel, type MomentsPayload } from "./youtube-panel";

const VIDEO_ID = "dQw4w9WgXcQ";
const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const C1 = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

const payload: MomentsPayload = {
  enabled: true,
  unavailable: false,
  moments: [
    { id: "m1", locator: { t_start: 125, t_end: 190 }, title: "칠판 그림", description: "그래프를 그린다", citable: true },
    { id: "m2", locator: { t_start: 400, t_end: 420 }, title: "엔딩", description: "자막 없음", citable: false },
  ],
  summary: [{ text: "도입부에서 주제를 소개한다", citations: [{ chunk_id: C1, t_start: 30 }] }],
};

const iframeSrc = () => new URL(document.querySelector("iframe")!.getAttribute("src")!);

function stubMoments(body: unknown, status = 200) {
  const fn = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("유튜브 임베드 주소", () => {
  it("youtube-nocookie 임베드, start·autoplay 인자, 형식이 틀린 video_id는 null", () => {
    expect(embedUrl(VIDEO_ID, 125.7, true)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?start=125&autoplay=1`);
    expect(embedUrl(VIDEO_ID, null, false)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`);
    expect(embedUrl("abc", 1, true)).toBeNull();
    expect(embedUrl(`${VIDEO_ID}"><script>`, 1, true)).toBeNull();
    expect(embedUrl(null, 1, true)).toBeNull();
  });

  it("양방향·zero-width 문자를 지운다", () => {
    expect(cleanUntrustedText("a‮b​c⁦d﻿")).toBe("abcd");
  });

  it("video_id가 틀리면 iframe 대신 원본 링크를 보여 준다", () => {
    render(<EmbedPlayer videoId="bad" title="영상" originalUrl="https://www.youtube.com/watch?v=x" start={0} autoplay={false} playKey={0} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /유튜브에서 보기/ }).getAttribute("href")).toBe("https://www.youtube.com/watch?v=x");
  });

  it("iframe은 referrerpolicy를 바꾸지 않고 제목을 단다", () => {
    render(<EmbedPlayer videoId={VIDEO_ID} title="강연" originalUrl={null} start={10} autoplay={false} playKey={0} />);
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("referrerpolicy")).toBeNull();
    expect(frame.getAttribute("title")).toBe("강연 영상 플레이어");
  });
});

describe("장면 카드·영상 요약", () => {
  it("카드를 누르면 그 장면의 t_start를 재생 인자로 넘긴다", () => {
    const onSeek = vi.fn();
    render(<MomentCards moments={payload.enabled && !payload.unavailable ? payload.moments : []} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /02:05 ~ 03:10 재생: 칠판 그림/ }));
    expect(onSeek).toHaveBeenCalledWith(125);
    expect(screen.getByText("AI가 본 장면 · 전사 근거 아님")).toBeTruthy();
    expect(screen.getAllByText("겹치는 전사가 없어 리포트에 인용할 수 없습니다.")).toHaveLength(1);
  });

  it("장면이 없으면 안내", () => {
    render(<MomentCards moments={[]} onSeek={() => {}} />);
    expect(screen.getByText("이 영상에서 만든 장면 카드가 없습니다.")).toBeTruthy();
  });

  it("요약 문장의 mm:ss를 누르면 그 시각을 넘기고, 제목·설명의 <script>는 글자로 보인다", () => {
    const onSeek = vi.fn();
    render(<VideoSummary sentences={[{ text: "<script>alert(1)</script>‮요약", citations: [{ chunk_id: C1, t_start: 30 }] }]} onSeek={onSeek} />);
    expect(screen.getByText("<script>alert(1)</script>요약")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "00:30부터 재생" }));
    expect(onSeek).toHaveBeenCalledWith(30);
  });
});

describe("S-10 유튜브 패널", () => {
  it("처음엔 인용 위치에서 멈춰 있고, 카드를 누르면 iframe이 그 시각부터 자동 재생한다", async () => {
    const fetchMock = stubMoments(payload);
    render(<YoutubePanel sourceId={SOURCE_ID} videoId={VIDEO_ID} title="강연" originalUrl={null} initialStart={60} />);
    expect(iframeSrc().searchParams.get("start")).toBe("60");
    expect(iframeSrc().searchParams.get("autoplay")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /칠판 그림/ }));
    expect(iframeSrc().pathname).toBe(`/embed/${VIDEO_ID}`);
    expect(iframeSrc().searchParams.get("start")).toBe("125");
    expect(iframeSrc().searchParams.get("autoplay")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "00:30부터 재생" }));
    expect(iframeSrc().searchParams.get("start")).toBe("30");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`/api/sources/${SOURCE_ID}/moments`);
  });

  it("플래그 꺼짐 응답이면 플레이어·요약·카드 대신 준비 중", async () => {
    stubMoments({ enabled: false });
    render(<YoutubePanel sourceId={SOURCE_ID} videoId={VIDEO_ID} title="강연" originalUrl={null} initialStart={null} />);
    expect(await screen.findByText(/유튜브 기능 준비 중/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("비활성 응답이면 플레이어·장면 카드를 숨긴다", async () => {
    stubMoments({ enabled: true, unavailable: true });
    render(<YoutubePanel sourceId={SOURCE_ID} videoId={VIDEO_ID} title="강연" originalUrl={null} initialStart={null} />);
    expect(await screen.findByText("원본 영상을 더 이상 볼 수 없습니다")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("장면 카드")).toBeNull();
  });

  it("오류면 다시 시도", async () => {
    const fetchMock = stubMoments({ error: {} }, 500);
    render(<YoutubePanel sourceId={SOURCE_ID} videoId={VIDEO_ID} title="강연" originalUrl={null} initialStart={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /다시 시도/ }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("유튜브 컴포넌트 HTML 주입 금지", () => {
  it("components/youtube 소스에 dangerouslySetInnerHTML이 없다", () => {
    const dir = join(process.cwd(), "src/components/youtube");
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) expect(readFileSync(join(dir, name), "utf8"), name).not.toContain("dangerouslySetInnerHTML");
  });
});
