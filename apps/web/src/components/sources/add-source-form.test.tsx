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

describe("AddSourceForm 자료부터 넣기(S-06, projectId 없음)", () => {
  const NEW_ID = "33333333-3333-4333-8333-333333333333";
  const push = pushMock;

  function setup(fetchImpl: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      return fetchImpl(url, init);
    });
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockReset();
  });

  it("PDF 파일명(확장자 제외)으로 프로젝트를 만들고 등록 후 프로젝트 화면으로 이동한다", async () => {
    const calls = setup((url, init) =>
      init?.method === "POST" && url === "/api/projects" ? Response.json({ id: NEW_ID }, { status: 201 }) : new Response("{}", { status: 404 }),
    );
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
    render(<AddSourceForm deps={deps} />);
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: [pdf("분기 보고서.pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/projects/${NEW_ID}`));
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "분기 보고서" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("업로드 등록이 모두 실패하면 만든 프로젝트를 삭제하고 이동하지 않는다", async () => {
    const calls = setup((url, init) =>
      init?.method === "POST" ? Response.json({ id: NEW_ID }, { status: 201 }) : init?.method === "DELETE" ? Response.json({ ok: true }) : Response.json({ sources: [] }),
    );
    const deps: UploadDeps = {
      fetch: (async () => Response.json({ error: { message: "실패" } }, { status: 500 })) as unknown as typeof fetch,
      upload: async () => ({}),
      hash: async () => "a".repeat(64),
      newKey: () => "k",
    };
    render(<AddSourceForm deps={deps} />);
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/projects/${NEW_ID}`)).toBe(true));
    expect(push).not.toHaveBeenCalled();
  });

  it("유튜브는 임시 이름으로 만든 뒤 영상 제목으로 이름을 바꾸고 이동한다", async () => {
    const calls = setup((url, init) => {
      if (url === "/api/projects" && init?.method === "POST") return Response.json({ id: NEW_ID }, { status: 201 });
      if (url === `/api/projects/${NEW_ID}` && !init?.method) return Response.json({ sources: [{ title: "멋진 영상" }] });
      if (init?.method === "PATCH") return Response.json({ id: NEW_ID });
      return new Response("{}", { status: 404 });
    });
    const deps: UploadDeps = {
      fetch: (async () => Response.json({ source_id: "s" }, { status: 202 })) as unknown as typeof fetch,
      upload: async () => ({}),
      hash: async () => "a".repeat(64),
      newKey: () => "k",
    };
    render(<AddSourceForm deps={deps} youtubeEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "유튜브" }));
    fireEvent.change(screen.getByLabelText(/유튜브 영상 주소/), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/projects/${NEW_ID}`));
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "유튜브 영상 dQw4w9WgXcQ" });
    expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body!)).toEqual({ name: "멋진 영상" });
  });

  const failDeps = (): UploadDeps => ({
    fetch: (async () => {
      throw new Error("lost");
    }) as unknown as typeof fetch,
    upload: async () => ({}),
    hash: async () => "a".repeat(64),
    newKey: () => "k",
  });
  const pickAndSubmit = (...names: string[]) => {
    fireEvent.change(screen.getByLabelText(/PDF 파일/), { target: { files: names.map((n) => pdf(n)) } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
  };

  it("응답이 유실돼 자료 수를 확인할 수 없으면 삭제하지 않고 프로젝트 링크를 안내한다", async () => {
    const calls = setup((url, init) =>
      init?.method === "POST" ? Response.json({ id: NEW_ID }, { status: 201 }) : new Response("{}", { status: 500 }),
    );
    render(<AddSourceForm deps={failDeps()} />);
    pickAndSubmit("a.pdf");
    await screen.findByText("프로젝트가 만들어졌지만 자료 등록을 확인하지 못했습니다.");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByRole("link", { name: "프로젝트로 이동" }).getAttribute("href")).toBe(`/projects/${NEW_ID}`);
    expect(push).not.toHaveBeenCalled();
  });

  it("재조회에서 자료가 1건 이상이면 삭제하지 않는다", async () => {
    const calls = setup((url, init) =>
      init?.method === "POST" ? Response.json({ id: NEW_ID }, { status: 201 }) : Response.json({ sources: [{ title: "a" }] }),
    );
    render(<AddSourceForm deps={failDeps()} />);
    pickAndSubmit("a.pdf");
    await screen.findByRole("link", { name: "프로젝트로 이동" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("정리(삭제)가 실패하면 빈 프로젝트가 남았다고 안내한다", async () => {
    setup((url, init) =>
      init?.method === "POST"
        ? Response.json({ id: NEW_ID }, { status: 201 })
        : init?.method === "DELETE"
          ? new Response("{}", { status: 500 })
          : Response.json({ sources: [] }),
    );
    render(<AddSourceForm deps={failDeps()} />);
    pickAndSubmit("a.pdf");
    await screen.findByText(/빈 프로젝트가 남았습니다/);
    expect(screen.getByRole("link", { name: "프로젝트로 이동" })).toBeTruthy();
  });

  it("PDF 일부만 등록되면 이동하지 않고 파일별 상태와 프로젝트 링크를 보인다", async () => {
    const calls = setup((url, init) => (init?.method === "POST" ? Response.json({ id: NEW_ID }, { status: 201 }) : new Response("{}", { status: 404 })));
    const responses = [
      Response.json({
        uploads: [
          { path: "p/a.pdf", title: "a", token: "t" },
          { path: "p/b.pdf", title: "b", token: "t" },
        ],
      }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true }, { path: "p/b.pdf", ok: false, message: "거절됨" }] }, { status: 202 }),
    ];
    const deps: UploadDeps = { ...failDeps(), fetch: (async () => responses.shift()!) as unknown as typeof fetch };
    render(<AddSourceForm deps={deps} />);
    pickAndSubmit("a.pdf", "b.pdf");
    await screen.findByText(/일부 파일만 등록되었습니다/);
    expect(screen.getByText(/거절됨/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "프로젝트로 이동" }).getAttribute("href")).toBe(`/projects/${NEW_ID}`);
    expect(push).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
