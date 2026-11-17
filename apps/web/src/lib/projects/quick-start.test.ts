import { describe, expect, it } from "vitest";
import { clampProjectName, projectNameFromPdf, projectNameFromYoutubeId, youtubeVideoIdFromUrl } from "./quick-start";

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
