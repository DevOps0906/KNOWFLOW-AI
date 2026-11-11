import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import type { SourceMeta } from "@/components/workspace/viewer/format";
import { SourceMetaHeader } from "@/components/workspace/viewer/source-meta";
import { SourceViewer } from "@/components/workspace/viewer/source-viewer";
import { supabaseEnv } from "@/lib/auth/supabase-server";
import { sourceReadHandlersForRequest } from "@/lib/sources/server";

export const metadata: Metadata = { title: "원문 보기 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// S-10 문서 뷰어. 메타는 A-07 핸들러(RLS 세션)로 서버에서 읽고, 원문 청크는 클라이언트가 /chunks로 이어 읽는다.
export default async function SourceViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceId: string }>;
  searchParams: SearchParams;
}) {
  const { sourceId } = await params;
  const chunkParam = (await searchParams).chunk;
  const initialChunkId = (Array.isArray(chunkParam) ? chunkParam[0] : chunkParam) || null;

  if (!supabaseEnv()) notFound();
  const handlers = await sourceReadHandlersForRequest();
  // 핸들러는 요청 본문·쿼리를 쓰지 않는다(소유·없음 판정은 RLS)
  const res = await handlers.source(new Request("http://localhost/"), sourceId);
  if (res.status === 401) redirect("/login");
  if (res.status === 404) notFound();

  const pageHref = `/sources/${sourceId}${initialChunkId ? `?chunk=${encodeURIComponent(initialChunkId)}` : ""}`;
  if (!res.ok) {
    return (
      <div className="mx-auto flex max-w-4xl min-w-0 flex-col gap-4 p-4 md:p-6">
        <ErrorState title="자료를 불러오지 못했습니다" />
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={pageHref}>다시 시도</Link>
        </Button>
      </div>
    );
  }
  const { source } = (await res.json()) as { source: SourceMeta };

  return (
    <div className="mx-auto flex max-w-4xl min-w-0 flex-col gap-6 p-4 md:p-6">
      <SourceMetaHeader source={source} />
      <SourceViewer key={`${source.id}:${initialChunkId ?? ""}`} source={source} initialChunkId={initialChunkId} />
    </div>
  );
}
