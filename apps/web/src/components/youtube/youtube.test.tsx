import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanText, embedSrc, isValidVideoId, type MomentsResponse } from "./embed";
import { YoutubePanel } from "./youtube-panel";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const VIDEO = "dQw4w9WgXcQ";
const CHUNK = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

const ok = (over: Partial<Extract<MomentsResponse, { enabled: true }>> = {}): MomentsResponse => ({
  enabled: true,
  unavailable: false,
  items: [],
  summary: null,
  ...over,
});

function stubMoments(body: MomentsResponse | Response) {
  const fn = vi.fn(async () => (body instanceof Response ? body : Response.json(body)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderPanel(videoId: string | null = VIDEO, startSeconds: number | null = null) {
  return render(
    <YoutubePanel sourceId={SOURCE_ID} videoId={videoId} title="강연 영상" originalUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" startSeconds={startSeconds} />,
  );
}

const iframeSrc = () => document.querySelector("iframe")?.getAttribute("src") ?? null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("임베드 주소·비신뢰 텍스트", () => {
  it("video_id는 11자 정규식으로 다시 확인한다", () => {
    expect(isValidVideoId(VIDEO)).toBe(true);
    expect(isValidVideoId("a-b_c1234XY")).toBe(true);
    for (const bad of ["abc", `${VIDEO}x`, "dQw4w9WgXc!", "dQw4w9/gXcQ", "dQw4w9WgXc ", "", null, undefined]) {
      expect(isValidVideoId(bad)).toBe(false);
      expect(embedSrc(bad, 10, true)).toBeNull();
    }
  });

  it("youtube-nocookie 주소에 start·autoplay만 붙인다", () => {
    expect(embedSrc(VIDEO, null, false)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}`);
    expect(embedSrc(VIDEO, 0, false)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}`);
    expect(embedSrc(VIDEO, 75.9, true)).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=75&autoplay=1`);
  });

  it("양방향 제어·zero-width 문자를 지운다", () => {
    expect(cleanText("a‮b​c⁦d﻿e‏f")).toBe("abcdef");
  });
});

describe("S-10 유튜브 플레이어·장면 카드", () => {
  it("장면 카드를 누르면 iframe src에 그 시각(start=N)과 autoplay를 넘긴다", async () => {
    stubMoments(
      ok({
        items: [
          { id: "m1", moment_index: 0, locator: { t_start: 42, t_end: 60 }, title: "도입", description: "발표자가 주제를 소개한다", citable: true },
          { id: "m2", moment_index: 1, locator: { t_start: 125, t_end: 140 }, title: "도표", description: "막대그래프", citable: false },
        ],
      }),
    );
    renderPanel(VIDEO, 30);
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=30`);
    fireEvent.click(await screen.findByRole("button", { name: /02:05/ }));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=125&autoplay=1`);
    fireEvent.click(screen.getByRole("button", { name: /00:42/ }));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=42&autoplay=1`);
    expect(screen.getAllByText("AI가 본 장면, 전사 근거 아님")).toHaveLength(2);
    expect(screen.getAllByText(/리포트에 인용할 수 없습니다/)).toHaveLength(1);
  });

  it("요약 문장의 mm:ss를 누르면 그 시각부터 재생한다", async () => {
    stubMoments(ok({ summary: { sentences: [{ text: "핵심은 세 가지다.", citations: [{ chunk_id: CHUNK, t_start: 61 }] }] } }));
    renderPanel();
    expect(await screen.findByText("핵심은 세 가지다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /01:01/ }));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VIDEO}?start=61&autoplay=1`);
  });

  it("형식이 틀린 video_id는 iframe을 그리지 않고 원본 링크를 준다", async () => {
    stubMoments(ok());
    renderPanel('x" onload="alert(1)');
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /원본에서 보기/ })).toBeTruthy();
    expect(await screen.findByText("이 영상에서 만든 장면 카드가 없습니다.")).toBeTruthy();
  });

  it("서버 플래그가 꺼져 있으면({enabled:false}) '유튜브 기능 준비 중'만 보인다", async () => {
    stubMoments({ enabled: false });
    renderPanel();
    expect(await screen.findByText(/유튜브 기능 준비 중/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("비활성 자료(unavailable)는 플레이어·장면 카드를 숨긴다", async () => {
    stubMoments(ok({ unavailable: true }));
    renderPanel();
    expect(await screen.findByText("원본 영상을 더 이상 볼 수 없습니다")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("장면 카드")).toBeNull();
  });

  it("오류면 다시 시도할 수 있다", async () => {
    const fn = stubMoments(new Response(null, { status: 500 }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("장면 제목·설명·요약의 HTML은 글자로만 보이고 제어 문자는 지운다", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    stubMoments(
      ok({
        items: [{ id: "m1", moment_index: 0, locator: { t_start: 1, t_end: 2 }, title: `‮${evil}`, description: "<script>x</script>", citable: true }],
        summary: { sentences: [{ text: `요약${evil}`, citations: [{ chunk_id: CHUNK, t_start: 1 }] }] },
      }),
    );
    const { container } = renderPanel();
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(screen.getByText("<script>x</script>")).toBeTruthy();
    expect(screen.getByText(`요약${evil}`)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("‮");
  });
});
