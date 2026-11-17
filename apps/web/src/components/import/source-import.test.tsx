import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadDeps } from "@/lib/storage/upload-flow";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: (...a: unknown[]) => push(...a) }) }));

import { importHref } from "./import-href";
import { SourceImport } from "./source-import";

const FOLDER = "22222222-2222-4222-8222-222222222222";
const INBOX = "33333333-3333-4333-8333-333333333333";
const pdf = (name = "a.pdf") => new File([new Uint8Array(10)], name, { type: "application/pdf" });
const depsWith = (responses: Response[]): UploadDeps => ({
  fetch: vi.fn(async () => responses.shift()!) as unknown as typeof fetch,
  upload: async () => ({}),
  hash: async () => "a".repeat(64),
  newKey: () => "k",
});

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("importHref", () => {
  it("유튜브가 켜져 있으면 /new/source, 꺼져 있으면 문서 탭, 폴더는 쿼리로 붙인다", () => {
    expect(importHref(true)).toBe("/new/source");
    expect(importHref(false)).toBe("/new/source/pdf");
    expect(importHref(true, FOLDER, "pdf")).toBe(`/new/source/pdf?folder=${FOLDER}`);
  });
});

describe("가져오기 화면 /new/source", () => {
  it("제목과 탭 줄: 유튜브 탭이 선택돼 있고 웹사이트는 준비 중으로 비활성", () => {
    render(<SourceImport tab="youtube" youtubeEnabled />);
    expect(screen.getByRole("heading", { level: 1, name: "무엇을 읽고 정리할까요?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "유튜브" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "문서" }).getAttribute("href")).toBe("/new/source/pdf");
    expect(screen.queryByRole("link", { name: /웹사이트/ })).toBeNull();
    expect(screen.getByText("웹사이트").closest("[aria-disabled]")).toBeTruthy();
    expect(screen.getByText(/‘받은 자료’ 폴더에 들어가고/)).toBeTruthy();
  });

  it("유튜브 기능이 꺼져 있으면 유튜브 탭은 링크가 아니다", () => {
    render(<SourceImport tab="pdf" youtubeEnabled={false} />);
    expect(screen.queryByRole("link", { name: "유튜브" })).toBeNull();
    expect(screen.getByRole("link", { name: "문서" }).getAttribute("aria-current")).toBe("page");
  });

  it("유튜브 주소를 넣으면 기본 폴더에 등록하고 자료 결과 화면으로 이동한다", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      init?.method === "POST" && url === "/api/projects/inbox" ? Response.json({ id: INBOX }) : new Response("{}", { status: 404 }),
    );
    const deps = depsWith([Response.json({ sourceId: "yt-1" }, { status: 202 })]);
    render(<SourceImport tab="youtube" youtubeEnabled deps={deps} />);
    const submit = screen.getByRole("button", { name: "가져오기" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("유튜브 영상 주소"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(submit);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources/yt-1"));
    expect((deps.fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe(`/api/projects/${INBOX}/sources`);
  });

  it("유튜브 등록이 거부되면 서버 문구를 보인다", async () => {
    const deps = depsWith([Response.json({ error: { message: "어린이용 영상은 지원하지 않습니다." } }, { status: 422 })]);
    render(<SourceImport tab="youtube" youtubeEnabled folder={{ id: FOLDER, name: "시장 조사" }} deps={deps} />);
    fireEvent.change(screen.getByLabelText("유튜브 영상 주소"), { target: { value: "https://youtu.be/x" } });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("어린이용"));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("가져오기 화면 /new/source/pdf", () => {
  it("폴더를 받았으면 그 폴더에 PDF를 올리고 결과 화면으로 이동한다", async () => {
    const deps = depsWith([
      Response.json({ uploads: [{ path: "p/a.pdf", title: "a", token: "t" }] }),
      Response.json({ results: [{ path: "p/a.pdf", ok: true, sourceId: "s-1" }] }, { status: 202 }),
    ]);
    render(<SourceImport tab="pdf" youtubeEnabled folder={{ id: FOLDER, name: "시장 조사" }} deps={deps} />);
    expect(screen.getByText(/‘시장 조사’ 폴더에 들어가고/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "유튜브" }).getAttribute("href")).toBe(`/new/source?folder=${FOLDER}`);
    fireEvent.change(screen.getByLabelText("PDF 파일 선택"), { target: { files: [pdf()] } });
    expect(screen.getByText("1개 선택됨")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources/s-1"));
    expect((deps.fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe(`/api/projects/${FOLDER}/sources`);
  });

  it("끌어다 놓은 파일도 고르며, PDF가 아니면 오류를 보이고 가져오기를 막는다", () => {
    render(<SourceImport tab="pdf" youtubeEnabled={false} />);
    const zone = screen.getByText("파일을 끌어다 놓거나 클릭해서 선택").closest("label")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "memo.txt", { type: "text/plain" })] } });
    expect(screen.getByText(/PDF 파일만 올릴 수 있습니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "가져오기" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
