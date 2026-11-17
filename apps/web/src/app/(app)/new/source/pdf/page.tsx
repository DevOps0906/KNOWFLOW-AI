import type { Metadata } from "next";
import { ImportPage, type ImportSearchParams } from "../import-page";

export const metadata: Metadata = { title: "문서 가져오기 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

// 가져오기 화면 문서 탭(DESIGN.md §2-2).
export default function NewSourcePdfPage({ searchParams }: { searchParams: ImportSearchParams }) {
  return <ImportPage tab="pdf" searchParams={searchParams} />;
}
