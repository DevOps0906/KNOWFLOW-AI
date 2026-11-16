import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedSrc } from "./embed";
import { cleanUntrustedText } from "./sanitize";
import { YoutubePanel } from "./youtube-panel";

const VID = "dQw4w9WgXcQ";
const SOURCE = { id: "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21", video_id: VID, original_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };

const body = {
  enabled: true,
  unavailable: false,
  moments: [{ id: "m1", moment_index: 0, t_start: 125, t_end: 190, title: "도입 장면", description: "발표자가 나온다" }],
  summary: { model: "stub", sentences: [{ text: "핵심 요약 문장", citations: [{ chunk_id: "c1", t_start: 61 }] }] },
};

function stub(payload: unknown, status = 200) {
  const fn = vi.fn(async () => Response.json(payload, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const iframeSrc = () => document.querySelector("iframe")?.getAttribute("src");

describe("embedSrc", () => {
  it("11자 video_id만 youtube-nocookie 임베드 주소를 만든다", () => {
    expect(embedSrc(VID, 83.7, true)).toBe(`https://www.youtube-nocookie.com/embed/${VID}?start=83&autoplay=1`);
    expect(embedSrc(VID, null, false)).toBe(`https://www.youtube-nocookie.com/embed/${VID}`);
    expect(embedSrc("abc", 1, true)).toBeNull();
    expect(embedSrc(`${VID}"><script>`, 1, true)).toBeNull();
    expect(embedSrc(null, 1, true)).toBeNull();
  });
});

describe("cleanUntrustedText", () => {
  it("양방향 제어 문자와 zero-width를 지운다", () => {
    expect(cleanUntrustedText("a‮b​c⁦d﻿e\u0007f")).toBe("abcdef");
    expect(cleanUntrustedText(42)).toBe("");
  });
});

describe("YoutubePanel", () => {
  it("장면 카드·요약 인용 클릭 시 iframe src가 그 시각 autoplay로 바뀐다", async () => {
    stub(body);
    render(<YoutubePanel source={SOURCE} startSeconds={null} enabled />);
    expect(await screen.findByText("도입 장면")).toBeTruthy();
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VID}`);
    expect(screen.getByText("AI가 본 장면, 전사 근거 아님")).toBeTruthy();

    fireEvent.click(screen.getByText("도입 장면"));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VID}?start=125&autoplay=1`);

    fireEvent.click(screen.getByRole("button", { name: "01:01부터 재생" }));
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VID}?start=61&autoplay=1`);
    expect(document.querySelector("img")).toBeNull();
  });

  it("video_id 형식이 틀리면 플레이어를 그리지 않고 안내한다", async () => {
    stub(body);
    render(<YoutubePanel source={{ ...SOURCE, video_id: "abc" }} startSeconds={null} enabled />);
    expect(await screen.findByText("도입 장면")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/여기서 재생할 수 없습니다/)).toBeTruthy();
  });

  it("플래그가 꺼지면 준비 중만 보이고 요청하지 않는다", () => {
    const fetchMock = stub(body);
    render(<YoutubePanel source={SOURCE} startSeconds={null} enabled={false} />);
    expect(screen.getByText("유튜브 기능 준비 중")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("서버가 enabled:false면 준비 중", async () => {
    stub({ enabled: false });
    render(<YoutubePanel source={SOURCE} startSeconds={null} enabled />);
    expect(await screen.findByText("유튜브 기능 준비 중")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("unavailable이면 플레이어·요약·장면을 숨긴다", async () => {
    stub({ enabled: true, unavailable: true });
    render(<YoutubePanel source={SOURCE} startSeconds={null} enabled />);
    expect(await screen.findByText(/요약과 장면 카드를 숨겼습니다/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("장면 0건은 안내(비활성과 구분), 텍스트의 HTML과 제어 문자는 글자로만", async () => {
    stub({
      ...body,
      moments: [{ id: "m1", t_start: 1, t_end: 2, title: "<b>굵게</b>‮", description: "" }],
      summary: null,
    });
    const { container } = render(<YoutubePanel source={SOURCE} startSeconds={null} enabled />);
    expect(await screen.findByText("<b>굵게</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("영상 요약이 아직 없습니다.")).toBeTruthy();
    cleanup();
    stub({ ...body, moments: [], summary: null });
    render(<YoutubePanel source={SOURCE} startSeconds={null} enabled />);
    expect(await screen.findByText("이 영상에서 찾은 장면 카드가 없습니다.")).toBeTruthy();
  });

  it("불러오기 실패 시 오류와 다시 시도, 플레이어는 유지", async () => {
    const fn = stub({}, 500);
    render(<YoutubePanel source={SOURCE} startSeconds={30} enabled />);
    expect(await screen.findByText("영상 요약과 장면 카드를 불러오지 못했습니다")).toBeTruthy();
    expect(iframeSrc()).toBe(`https://www.youtube-nocookie.com/embed/${VID}?start=30`);
    fireEvent.click(screen.getByRole("button", { name: /다시 시도/ }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});

describe("components/youtube HTML 주입 금지·썸네일 없음", () => {
  it("dangerouslySetInnerHTML·next/image가 없다", () => {
    const dir = join(process.cwd(), "src/components/youtube");
    const files = readdirSync(dir)
      .map((n) => join(dir, n))
      .filter((f) => statSync(f).isFile() && /\.tsx?$/.test(f) && !f.includes(".test."));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toContain("dangerouslySetInnerHTML");
      expect(text).not.toContain("next/image");
    }
  });
});
