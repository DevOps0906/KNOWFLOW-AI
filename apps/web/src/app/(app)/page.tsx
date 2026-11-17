import type { Metadata } from "next";
import { ImportPage, type ImportSearchParams } from "./new/source/import-page";
import { isYoutubeEnabled } from "@/server/youtube/service";

export const metadata: Metadata = { title: "자료 가져오기 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

// 홈("/") = 가져오기 화면(DESIGN.md §2-2). 유튜브 탭이 기본, 꺼져 있으면 문서 탭.
// "/"는 proxy 보호 목록에 넣을 수 없어(접두사 규칙) 로그인 확인은 ImportPage가 한다. 비로그인은 /login.
export default function HomePage({ searchParams }: { searchParams: ImportSearchParams }) {
  return <ImportPage tab={isYoutubeEnabled() ? "youtube" : "pdf"} searchParams={searchParams} />;
}
