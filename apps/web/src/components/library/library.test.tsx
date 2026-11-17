import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryHref, parseLibraryParams, type LibrarySourceItem } from "@/lib/sources/library";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }), usePathname: () => "/sources" }));

import { ImportDialog } from "@/components/import/import-dialog";
import { FolderActions, NewFolderButton } from "./folder-dialogs";
import { formatLibraryDate, SourceLibrary } from "./source-library";

const FOLDER = "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22";
const OTHER = "44444444-4444-4444-8444-444444444444";
const item = (over: Partial<LibrarySourceItem> = {}): LibrarySourceItem => ({
  id: "s-1",
  folderId: FOLDER,
  folderName: "시장 조사",
  title: "분기 보고서",
  sourceType: "pdf",
  status: "completed",
  createdAt: "2026-11-02T00:00:00Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
  push.mockReset();
});

describe("자료 라이브러리 주소 파라미터", () => {
  it("모르는 값은 기본값, 폴더는 UUID만 받는다", () => {
    expect(parseLibraryParams({ folder: "x", status: "bad", type: "pdf", sort: "name", q: "  보고서 " })).toEqual({
      folder: null,
      q: "보고서",
      status: "all",
      type: "pdf",
      sort: "name",
    });
    expect(parseLibraryParams({ folder: FOLDER.toUpperCase() }).folder).toBe(FOLDER);
  });
  it("기본값이 아닌 것만 주소에 남긴다", () => {
    expect(libraryHref({ status: "all", type: "all", sort: "new" })).toBe("/sources");
    expect(libraryHref({ folder: FOLDER, status: "failed", q: "a b" })).toBe(`/sources?folder=${FOLDER}&q=a+b&status=failed`);
  });
});

describe("자료 라이브러리 행", () => {
  it("제목 링크는 자료 결과 화면, 보조 줄은 유형 · 폴더, 날짜는 YYYY.MM.DD", () => {
    render(<SourceLibrary items={[item(), item({ id: "s-2", title: "영상", sourceType: "youtube", status: "processing" })]} />);
    expect(screen.getByRole("link", { name: "분기 보고서" }).getAttribute("href")).toBe("/sources/s-1");
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.getAllByText("시장 조사").length).toBe(2);
    expect(screen.getAllByText(formatLibraryDate("2026-11-02T00:00:00Z"))[0]!.textContent).toBe("2026.11.02");
    // 완료 자료는 배지 없음, 처리 중만 배지
    expect(screen.getAllByText("처리 중").length).toBe(1);
    expect(screen.queryByText("완료")).toBeNull();
  });

  it("폴더 보기에서는 폴더 이름을 숨긴다", () => {
    render(<SourceLibrary items={[item()]} showFolder={false} />);
    expect(screen.queryByText("시장 조사")).toBeNull();
  });

  it("여러 개 골라 삭제하면 폴더별로 DELETE를 보내고 목록을 새로 읽는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, deleted: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SourceLibrary items={[item(), item({ id: "s-2", title: "둘째" }), item({ id: "s-3", title: "셋째", folderId: OTHER })]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "분기 보고서 선택" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "둘째 선택" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "셋째 선택" }));
    expect(screen.getByText("3개 선택")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => [url, init.method, JSON.parse(String(init.body))])).toEqual([
      [`/api/projects/${FOLDER}/sources`, "DELETE", { source_ids: ["s-1", "s-2"] }],
      [`/api/projects/${OTHER}/sources`, "DELETE", { source_ids: ["s-3"] }],
    ]);
  });

  it("삭제가 실패하면 안내한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<SourceLibrary items={[item()]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "분기 보고서 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect((await screen.findByRole("alert")).textContent).toContain("삭제하지 못했습니다");
  });
});

describe("폴더 다이얼로그", () => {
  it("폴더 추가는 이름만 POST하고 새로 읽는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "x" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewFolderButton />);
    fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
    fireEvent.change(screen.getByLabelText("폴더 이름"), { target: { value: "논문" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects");
    expect(JSON.parse(String(init.body))).toEqual({ name: "논문" });
  });

  it("폴더 삭제는 확인 후 DELETE하고 전체 자료로 돌아간다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FolderActions folder={{ id: FOLDER, name: "시장 조사" }} />);
    fireEvent.click(screen.getByRole("button", { name: "시장 조사 삭제" }));
    expect(screen.getByText("폴더를 삭제할까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sources"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method]).toEqual([`/api/projects/${FOLDER}`, "DELETE"]);
  });
});

describe("가져오기 다이얼로그", () => {
  it("폴더 선택은 기본 폴더(받은 자료)가 먼저이고 같은 이름 폴더는 목록에서 뺀다", () => {
    render(
      <ImportDialog
        folders={[
          { id: FOLDER, name: "시장 조사" },
          { id: OTHER, name: "받은 자료" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    const select = screen.getByLabelText(/폴더/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["받은 자료 (기본)", "시장 조사"]);
    expect(select.value).toBe("");
    expect(screen.getByRole("button", { name: "PDF" })).toBeTruthy();
  });

  it("폴더 보기에서 열면 그 폴더가 선택돼 있다", () => {
    render(<ImportDialog folders={[{ id: FOLDER, name: "시장 조사" }]} defaultFolderId={FOLDER} />);
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    expect((screen.getByLabelText(/폴더/) as HTMLSelectElement).value).toBe(FOLDER);
  });
});
