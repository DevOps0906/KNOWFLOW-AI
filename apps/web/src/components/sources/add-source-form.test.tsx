import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadDeps } from "@/lib/storage/upload-flow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
