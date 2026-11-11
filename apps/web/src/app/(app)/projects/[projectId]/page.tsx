import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "@/components/workspace/types";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceSkeleton } from "@/components/workspace/workspace-skeleton";
import { serverSupabaseOrNull } from "@/lib/projects/server";
import { createSourceReadHandlers } from "@/lib/sources/handlers";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { isYoutubeEnabled } from "@/server/youtube/service";

export const metadata: Metadata = { title: "워크스페이스 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

type Params = Promise<{ projectId: string }>;

// S-08 워크스페이스. 첫 화면은 A-03 GET과 같은 핸들러·같은 응답 형태로 서버에서 읽고(RLS), 이후 폴링은 클라이언트가 A-03을 부른다.
export default async function WorkspacePage({ params }: { params: Params }) {
  const { projectId } = await params;
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Workspace projectId={projectId} />
    </Suspense>
  );
}

async function Workspace({ projectId }: { projectId: string }) {
  const supabase = await serverSupabaseOrNull();
  if (!supabase) return <WorkspaceError projectId={projectId} />;
  const handlers = createSourceReadHandlers({ backend: createSupabaseSourceReadBackend(supabase) });
  const response = await handlers.projectDetail(new Request(`http://internal/api/projects/${projectId}`), projectId);
  if (response.status === 401) redirect("/login");
  // 타인·삭제·없는 프로젝트는 구분하지 않는다
  if (response.status === 404) notFound();
  if (!response.ok) return <WorkspaceError projectId={projectId} />;
  const detail = (await response.json()) as ProjectDetail;
  return <WorkspaceShell initial={detail} youtubeEnabled={isYoutubeEnabled()} />;
}

function WorkspaceError({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 p-4 md:p-6">
      <ErrorState title="워크스페이스를 불러오지 못했습니다" />
      <Button asChild variant="outline" size="sm">
        <Link href={`/projects/${encodeURIComponent(projectId)}`}>다시 시도</Link>
      </Button>
    </div>
  );
}
