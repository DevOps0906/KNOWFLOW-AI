// 가져오기 화면 경로(DESIGN.md §2-2): /new/source = 유튜브 탭, /new/source/pdf = 문서 탭.
// 유튜브 기능이 꺼져 있으면 문서 탭으로 바로 간다. folder가 있으면 그 폴더에 넣는다.
export type ImportTab = "youtube" | "pdf";

export function importHref(youtubeEnabled: boolean, folder?: string, tab?: ImportTab): string {
  const target = tab ?? (youtubeEnabled ? "youtube" : "pdf");
  const path = target === "youtube" ? "/new/source" : "/new/source/pdf";
  return folder ? `${path}?folder=${encodeURIComponent(folder)}` : path;
}
