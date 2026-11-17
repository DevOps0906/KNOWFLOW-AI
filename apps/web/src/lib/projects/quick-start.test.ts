import { describe, expect, it, vi } from "vitest";
import { clampProjectName, ensureInboxFolder, importDestination, projectNameFromPdf, projectNameFromYoutubeId, youtubeVideoIdFromUrl } from "./quick-start";

describe("자료부터 넣기 이름 규칙", () => {
  it("PDF 파일명에서 확장자를 뺀다", () => {
    expect(projectNameFromPdf("분기 보고서.PDF")).toBe("분기 보고서");
    expect(projectNameFromPdf(".pdf")).toBe("새 프로젝트");
  });
  it("100자(코드 포인트)로 자르고 공백을 정리한다", () => {
    expect(Array.from(clampProjectName("가".repeat(150))).length).toBe(100);
    expect(clampProjectName("😀".repeat(120))).toBe("😀".repeat(100));
    expect(clampProjectName("  a   b ")).toBe("a b");
  });
  it("유튜브 주소에서 video_id를 뽑고 이름은 '유튜브 영상 <id>'", () => {
    expect(youtubeVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(projectNameFromYoutubeId("dQw4w9WgXcQ")).toBe("유튜브 영상 dQw4w9WgXcQ");
  });
});

describe("가져오기 기본 폴더·이동 경로", () => {
  it("폴더를 고르지 않으면 기본 폴더 API를 POST로 부른다", async () => {
    const call = vi.fn(async () => ({ ok: true, status: 200, id: "inbox-1" }));
    expect((await ensureInboxFolder(call)).id).toBe("inbox-1");
    expect(call).toHaveBeenCalledWith("POST", "/api/projects/inbox");
  });
  it("자료 1건이면 결과 화면, 여러 건이면 폴더 라이브러리로 간다", () => {
    expect(importDestination(["s1"], "f1")).toBe("/sources/s1");
    expect(importDestination(["s1", "s2"], "f1")).toBe("/sources?folder=f1");
    expect(importDestination([], "f1")).toBe("/sources?folder=f1");
  });
});
