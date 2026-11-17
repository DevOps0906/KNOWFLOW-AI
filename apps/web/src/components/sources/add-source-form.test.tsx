import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadDeps } from "@/lib/storage/upload-flow";

const refresh = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: (...a: unknown[]) => pushMock(...a) }) }));

import { AddSourceForm } from "./add-source-form";

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

const PROJECT = "22222222-2222-4222-8222-222222222222";
const pdf = (name = "a.pdf") => new File([new Uint8Array(10)], name, { type: "application/pdf" });

describe("AddSourceForm(S-09)", () => {
  it("PDF 탭이 기본이고 URL 탭은 안내만 보이며 추가할 수 없다", () => {
    render(<AddSourceForm projectId={PROJECT} />);
    expect(screen.getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "추가" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect(screen.getByText("URL 가져오기는 곧 지원됩니다.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "추가" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("PDF가 아닌 파일은 선택 즉시 오류로 표시하고 추가를 막는다", () => {
    render(<AddSourceForm projectId={PROJECT} />);
    const input = screen.getByLabelText(/PDF 파일/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "memo.txt", { type: "text/plain" })] } });
    expect(screen.getByText(/PDF 파일만 올릴 수 있습니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "추가" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("업로드가 끝나면 '등록됨(분석 대기)'를 보여 주고 완료 콜백을 부른다", async () => {
    const responses = [
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true }] }, { status: 202 }),
    ];
    const deps: UploadDeps = {
      fetch: (async () => responses.shift()!) as unknown as typeof fetch,
      upload: async () => ({}),
      hash: async () => "a".repeat(64),
      newKey: () => "k",
    };
    const onDone = vi.fn();
    render(<AddSourceForm projectId={PROJECT} deps={deps} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/등록됨\(분석 대기\)/)).toBeTruthy();
  });

  it("서버가 거부하면 파일별 오류 문구를 보여 준다", async () => {
    const deps: UploadDeps = {
      fetch: (async () => Response.json({ error: { message: "파일은 1개당 50MB까지 올릴 수 있습니다." } }, { status: 413 })) as unknown as typeof fetch,
      upload: async () => ({}),
      hash: async () => "a".repeat(64),
      newKey: () => "k",
    };
    render(<AddSourceForm projectId={PROJECT} deps={deps} />);
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(screen.getByText(/50MB까지/, { selector: "span" })).toBeTruthy());
  });
  it("유튜브 탭은 기능 플래그가 꺼지면 그리지 않는다", () => {
    render(<AddSourceForm projectId={PROJECT} />);
    expect(screen.queryByRole("button", { name: "유튜브" })).toBeNull();
  });

  it("유튜브 탭: 영상 주소를 보내고 등록되면 완료 콜백을 부른다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sourceId: "s1", jobId: "j1", duplicate: false, status: "queued" }, { status: 202 }));
    const deps: UploadDeps = { fetch: fetchMock as unknown as typeof fetch, upload: async () => ({}), hash: async () => "", newKey: () => "k-1" };
    const onDone = vi.fn();
    render(<AddSourceForm projectId={PROJECT} deps={deps} onDone={onDone} youtubeEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "유튜브" }));
    fireEvent.change(screen.getByLabelText(/유튜브 영상 주소/), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ source_type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
    expect(refresh).toHaveBeenCalled();
  });

  it("유튜브 탭: 서버 거절 사유를 그대로 보여 준다", async () => {
    const deps: UploadDeps = {
      fetch: (async () => Response.json({ error: { code: "video_made_for_kids", message: "어린이용으로 지정된 영상은 등록할 수 없습니다." } }, { status: 422 })) as unknown as typeof fetch,
      upload: async () => ({}),
      hash: async () => "",
      newKey: () => "k",
    };
    render(<AddSourceForm projectId={PROJECT} deps={deps} youtubeEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "유튜브" }));
    fireEvent.change(screen.getByLabelText(/유튜브 영상 주소/), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("어린이용"));
  });
});

describe("AddSourceForm 가져오기(폴더 미선택 = 기본 폴더 받은 자료)", () => {
  const INBOX = "33333333-3333-4333-8333-333333333333";
  const push = pushMock;

  function setup(fetchImpl: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return fetchImpl(url, init);
    });
    return calls;
  }
  const inboxOk = () => setup((url, init) => (init?.method === "POST" && url === "/api/projects/inbox" ? Response.json({ id: INBOX }) : new Response("{}", { status: 404 })));
  const pdfDeps = (responses: Response[]): UploadDeps => ({
    fetch: vi.fn(async () => responses.shift()!) as unknown as typeof fetch,
    upload: async () => ({}),
    hash: async () => "a".repeat(64),
    newKey: () => "k",
  });
  const pickAndSubmit = (...names: string[]) => {
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: names.map((n) => pdf(n)) } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockReset();
  });

  it("PDF 1개는 기본 폴더에 등록하고 그 자료 결과 화면으로 이동한다", async () => {
    const calls = inboxOk();
    const deps = pdfDeps([
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true, sourceId: "s-1" }] }, { status: 202 }),
    ]);
    const onDone = vi.fn();
    render(<AddSourceForm deps={deps} onDone={onDone} />);
    pickAndSubmit("분기 보고서.pdf");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources/s-1"));
    expect(calls).toEqual([{ url: "/api/projects/inbox", method: "POST" }]);
    expect((deps.fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe(`/api/projects/${INBOX}/sources`);
    expect(onDone).toHaveBeenCalled();
  });

  it("PDF 여러 개가 모두 등록되면 폴더 라이브러리로 이동한다", async () => {
    inboxOk();
    const deps = pdfDeps([
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }, { path: "p/b.pdf", title: "b", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true, sourceId: "s-1" }, { path: "p/b.pdf", ok: true, sourceId: "s-2" }] }, { status: 202 }),
    ]);
    render(<AddSourceForm deps={deps} />);
    pickAndSubmit("a.pdf", "b.pdf");
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/sources?folder=${INBOX}`));
  });

  it("폴더를 골랐고 openResult면 기본 폴더를 부르지 않고 그 폴더에 넣은 뒤 이동한다", async () => {
    const calls = inboxOk();
    const deps = pdfDeps([
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true, sourceId: "s-9" }] }, { status: 202 }),
    ]);
    render(<AddSourceForm projectId={PROJECT} openResult deps={deps} />);
    pickAndSubmit("a.pdf");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources/s-9"));
    expect(calls).toEqual([]);
  });

  it("기본 폴더를 준비하지 못하면 서버 문구를 보이고 업로드하지 않는다", async () => {
    setup(() => Response.json({ error: { message: "폴더는 최대 20개까지 만들 수 있습니다." } }, { status: 429 }));
    const deps = pdfDeps([]);
    render(<AddSourceForm deps={deps} />);
    pickAndSubmit("a.pdf");
    await screen.findByText(/최대 20개/);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("유튜브는 기본 폴더에 등록하고 응답의 sourceId 결과 화면으로 이동한다", async () => {
    inboxOk();
    const deps = pdfDeps([Response.json({ sourceId: "yt-1", jobId: "j", duplicate: false, status: "queued" }, { status: 202 })]);
    render(<AddSourceForm deps={deps} youtubeEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "유튜브" }));
    fireEvent.change(screen.getByLabelText(/유튜브 영상 주소/), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources/yt-1"));
  });

  it("PDF 일부만 등록되면 이동하지 않고 파일별 상태와 폴더 링크를 보인다", async () => {
    inboxOk();
    const deps = pdfDeps([
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }, { path: "p/b.pdf", title: "b", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true, sourceId: "s-1" }, { path: "p/b.pdf", ok: false, message: "거절됨" }] }, { status: 202 }),
    ]);
    render(<AddSourceForm deps={deps} />);
    pickAndSubmit("a.pdf", "b.pdf");
    await screen.findByText(/일부 파일만 등록되었습니다/);
    expect(screen.getByText(/거절됨/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "폴더 열기" }).getAttribute("href")).toBe(`/sources?folder=${INBOX}`);
    expect(push).not.toHaveBeenCalled();
  });
});
