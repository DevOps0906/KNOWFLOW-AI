import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimestamp, locatorLabel, safeExternalUrl, type ChunkPageResponse, type SourceMeta, type ViewerChunk } from "./format";
import { SourceMetaHeader } from "./source-meta";
import { SourceViewer } from "./source-viewer";

const SOURCE_ID = "5b0c7a2e-1d3f-4e6a-9b8c-7d6e5f4a3b21";
const CHUNK_A = "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const CHUNK_B = "1f2a3b4c-5d6e-4f7a-8b9c-1d2e3f4a5b6c";

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
  original_url: "https://www.youtube.com/watch?v=abc",
  video_id: "abc",
  channel_title: "지식 채널",
};

const chunk = (id: string, index: number, content: string, locator: Record<string, unknown> = { page: index + 1 }): ViewerChunk => ({
  id,
  chunk_index: index,
  content,
  locator,
});

const page = (over: Partial<ChunkPageResponse>): ChunkPageResponse => ({
  items: [],
  next_cursor: null,
  has_before: false,
  around: null,
  unavailable: false,
  ...over,
});

function stubFetch(...responses: Response[]) {
  const fn = vi.fn(async () => responses.shift() ?? Response.json(page({})));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calledUrl = (fn: ReturnType<typeof stubFetch>, i: number) => new URL(String((fn.mock.calls[i] as unknown[])[0]), "http://x");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("S-10 원문 뷰어", () => {
  it("?chunk로 들어오면 around 창을 읽고 그 청크를 강조·스크롤한다", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const fetchMock = stubFetch(
      Response.json(page({ items: [chunk(CHUNK_A, 4, "앞 문단"), chunk(CHUNK_B, 5, "인용 문단")], around: "found", has_before: true })),
    );
    render(<SourceViewer source={pdf} initialChunkId={CHUNK_B} />);
    const active = await waitFor(() => {
      const el = document.querySelector('[aria-current="location"]');
      if (!el) throw new Error("not yet");
      return el;
    });
    expect(active.getAttribute("data-chunk-id")).toBe(CHUNK_B);
    expect(active.className).toContain("bg-highlight-soft");
    expect(active.textContent).toContain("인용된 위치");
    expect(scroll).toHaveBeenCalled();
    const url = calledUrl(fetchMock, 0);
    expect(url.pathname).toBe(`/api/sources/${SOURCE_ID}/chunks`);
    expect(url.searchParams.get("chunk_id")).toBe(CHUNK_B);
    expect(url.searchParams.get("limit")).toBe("50");
    // PDF는 쪽 번호
    expect(screen.getByText("6쪽")).toBeTruthy();
  });

  it("has_before면 '처음부터 보기'로 커서 없이 처음부터 다시 읽는다", async () => {
    const fetchMock = stubFetch(
      Response.json(page({ items: [chunk(CHUNK_B, 5, "인용 문단")], around: "found", has_before: true })),
      Response.json(page({ items: [chunk(CHUNK_A, 0, "첫 문단")] })),
    );
    render(<SourceViewer source={pdf} initialChunkId={CHUNK_B} />);
    fireEvent.click(await screen.findByRole("button", { name: /처음부터 보기/ }));
    await screen.findByText("첫 문단");
    const url = calledUrl(fetchMock, 1);
    expect(url.searchParams.has("chunk_id")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("around가 not_found면 처음부터 보여 주고 안내한다", async () => {
    stubFetch(Response.json(page({ items: [chunk(CHUNK_A, 0, "첫 문단")], around: "not_found" })));
    render(<SourceViewer source={pdf} initialChunkId={CHUNK_B} />);
    expect((await screen.findByText(/인용된 위치를 찾지 못해 처음부터/)).closest("[role=status]")).toBeTruthy();
    expect(document.querySelector('[aria-current="location"]')).toBeNull();
  });

  it("next_cursor로 다음 쪽을 이어 읽고 뒤에 붙인다", async () => {
    const fetchMock = stubFetch(
      Response.json(page({ items: [chunk(CHUNK_A, 49, "50번째")], next_cursor: "49" })),
      Response.json(page({ items: [chunk(CHUNK_B, 50, "51번째")] })),
    );
    render(<SourceViewer source={pdf} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));
    await screen.findByText("51번째");
    expect(screen.getByText("50번째")).toBeTruthy();
    const url = calledUrl(fetchMock, 1);
    expect(url.searchParams.get("cursor")).toBe("49");
    expect(url.searchParams.has("chunk_id")).toBe(false);
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
    // 마지막 쪽이면 사라진 버튼 대신 끝 안내로 초점이 간다
    await waitFor(() => expect(document.activeElement?.textContent).toBe("원문의 끝입니다."));
  });

  it("이어 읽기 실패는 role=status로 알리고 다시 시도할 수 있다", async () => {
    stubFetch(
      Response.json(page({ items: [chunk(CHUNK_A, 49, "50번째")], next_cursor: "49" })),
      Response.json({ error: { message: "x" } }, { status: 500 }),
    );
    render(<SourceViewer source={pdf} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));
    await screen.findByRole("button", { name: "다시 시도" });
    const live = screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite");
    expect(live?.textContent).toBe("이어서 불러오지 못했습니다.");
  });

  it("not_found인데 원문이 비어도 위치 안내를 함께 보여 준다", async () => {
    stubFetch(Response.json(page({ items: [], around: "not_found" })));
    render(<SourceViewer source={pdf} initialChunkId={CHUNK_B} />);
    expect(await screen.findByText("표시할 원문이 없습니다")).toBeTruthy();
    expect(screen.getByText(/인용된 위치를 찾지 못해 처음부터/)).toBeTruthy();
  });

  it("/chunks가 409면 처리 중 안내를 보여 준다", async () => {
    stubFetch(
      Response.json(
        { error: { code: "source_not_ready", message: "아직 처리가 끝나지 않은 자료입니다. 처리가 끝난 뒤 다시 열어 주세요." } },
        { status: 409 },
      ),
    );
    render(<SourceViewer source={pdf} initialChunkId={null} />);
    expect(await screen.findByText("아직 처리가 끝나지 않은 자료입니다")).toBeTruthy();
    expect(screen.getByRole("link", { name: "워크스페이스로" }).getAttribute("href")).toBe(`/projects/${pdf.project_id}`);
  });

  it("처리 중·실패 자료는 청크를 요청하지 않고 상태를 안내한다", () => {
    const fetchMock = stubFetch();
    const { unmount } = render(<SourceViewer source={{ ...pdf, status: "processing" }} initialChunkId={null} />);
    expect(screen.getByText("아직 처리가 끝나지 않은 자료입니다")).toBeTruthy();
    unmount();
    render(<SourceViewer source={{ ...pdf, status: "failed", error_message: "암호가 걸린 PDF는 처리할 수 없습니다." }} initialChunkId={null} />);
    expect(screen.getByText("처리하지 못한 자료입니다")).toBeTruthy();
    expect(screen.getByText("암호가 걸린 PDF는 처리할 수 없습니다.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("비활성 영상은 메타만 보여 주고 전사·플레이어를 숨긴다", () => {
    const fetchMock = stubFetch();
    const inactive = { ...youtube, unavailable_at: "2026-11-10T00:00:00Z" };
    render(
      <>
        <SourceMetaHeader source={inactive} />
        <SourceViewer source={inactive} initialChunkId={null} />
      </>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "강연 영상" })).toBeTruthy();
    expect(screen.getByText("채널: 지식 채널")).toBeTruthy();
    expect(screen.getByText("원본 영상을 더 이상 볼 수 없습니다")).toBeTruthy();
    expect(screen.getByText(/더 이상 볼 수 없어 전사와 장면 카드를 숨겼습니다/)).toBeTruthy();
    expect(screen.queryByText(/비공개|삭제되어/)).toBeNull();
    expect(screen.queryByRole("region", { name: "전사 구간" })).toBeNull();
    expect(document.querySelector('[data-slot="youtube-viewer"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("응답의 unavailable=true도 메타만 보여 준다", async () => {
    stubFetch(Response.json(page({ unavailable: true })));
    render(<SourceViewer source={youtube} initialChunkId={null} />);
    expect(await screen.findByText("원본 영상을 더 이상 볼 수 없습니다")).toBeTruthy();
  });

  it("유튜브는 mm:ss를 표시하고 슬롯에 강조 청크의 t_start를 넘긴다", async () => {
    stubFetch(Response.json(page({ items: [chunk(CHUNK_A, 3, "전사", { t_start: 125, t_end: 190 })], around: "found" })));
    render(<SourceViewer source={youtube} initialChunkId={CHUNK_A} />);
    expect(await screen.findByText("02:05 ~ 03:10")).toBeTruthy();
    const slot = document.querySelector('[data-slot="youtube-viewer"]');
    expect(slot?.getAttribute("data-start-seconds")).toBe("125");
    expect(slot?.getAttribute("data-video-id")).toBe("abc");
  });

  it("원문의 <script>는 실행되지 않고 글자로 보인다", async () => {
    const evil = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    stubFetch(Response.json(page({ items: [chunk(CHUNK_A, 0, evil)] })));
    const { container } = render(
      <>
        <SourceMetaHeader source={{ ...pdf, title: "<script>alert(3)</script>" }} />
        <SourceViewer source={pdf} initialChunkId={null} />
      </>,
    );
    expect(await screen.findByText(evil)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("<script>alert(3)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("빈 원문은 안내와 워크스페이스로 버튼, 오류는 다시 시도를 보여 준다", async () => {
    stubFetch(Response.json(page({ items: [] })));
    const { unmount } = render(<SourceViewer source={pdf} initialChunkId={null} />);
    expect(await screen.findByText("표시할 원문이 없습니다")).toBeTruthy();
    unmount();
    const fetchMock = stubFetch(Response.json({ error: { message: "x" } }, { status: 500 }), Response.json(page({ items: [chunk(CHUNK_A, 0, "복구")] })));
    render(<SourceViewer source={pdf} initialChunkId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /다시 시도/ }));
    await screen.findByText("복구");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("표시 형식: 시각·쪽·원본 링크 검사", () => {
    expect(formatTimestamp(65)).toBe("01:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(locatorLabel("pdf", { page: 3, char_start: 0 })).toBe("3쪽");
    expect(locatorLabel("pdf", {})).toBeNull();
    expect(locatorLabel("youtube", { t_start: 5 })).toBe("00:05");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
  });
});

describe("S-10 HTML 주입 금지", () => {
  it("뷰어·페이지 소스에 dangerouslySetInnerHTML이 없다", () => {
    // vitest 루트는 apps/web
    const dirs = [join(process.cwd(), "src/components/workspace/viewer"), join(process.cwd(), "src/app/(app)/sources/[sourceId]")];
    const files: string[] = [];
    for (const dir of dirs) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isFile() && /\.tsx?$/.test(name) && !name.includes(".test.")) files.push(full);
      }
    }
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("dangerouslySetInnerHTML");
  });
});
