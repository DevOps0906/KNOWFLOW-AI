import type { Metadata } from "next";
import { ImportPage, type ImportSearchParams } from "./import-page";

export const metadata: Metadata = { title: "자료 가져오기 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

// 가져오기 화면 유튜브 탭(DESIGN.md §2-2). 유튜브 기능이 꺼져 있으면 문서 탭으로 보낸다.
export default function NewSourcePage({ searchParams }: { searchParams: ImportSearchParams }) {
  return <ImportPage tab="youtube" searchParams={searchParams} />;
}
