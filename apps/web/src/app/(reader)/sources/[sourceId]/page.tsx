import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportShell } from "@/components/report/report-shell";
import type { ReportFolder } from "@/components/report/types";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "@/components/workspace/types";
import type { SourceMeta } from "@/components/workspace/viewer/format";
import { supabaseEnv } from "@/lib/auth/supabase-server";
import { sourceReadHandlersForRequest } from "@/lib/sources/server";
import { isYoutubeEnabled } from "@/server/youtube/service";

export const metadata: Metadata = { title: "자료 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 자료 결과 화면(DESIGN.md §2-1). 메타는 A-07 핸들러, 폴더 요약·추천 질문은 A-03 핸들러(둘 다 RLS 세션)로 서버에서 읽는다.
// 원문 청크는 원문 카드가 /chunks로 이어 읽고, 처리 중이면 클라이언트가 A-07을 폴링한다.
export default async function SourceResultPage({
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

  // 폴더 정보는 보조: 못 읽어도 화면은 열고 요약만 비운다
  let folder: ReportFolder | null = null;
  const projectRes = await handlers.projectDetail(new Request("http://localhost/"), source.project_id);
  if (projectRes.ok) {
    const { project, sources } = (await projectRes.json()) as ProjectDetail;
    folder = {
      id: project.id,
      name: project.name,
      summary: project.summary,
      suggestedQuestions: project.suggested_questions,
      sourceCount: sources.length,
    };
  }

  return <ReportShell key={`${source.id}:${initialChunkId ?? ""}`} initialSource={source} folder={folder} initialChunkId={initialChunkId} youtubeEnabled={isYoutubeEnabled()} />;
}
