import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { sourceReadHandlersForRequest } from "@/lib/sources/server";
import { createSourceHandlers } from "@/lib/storage/handlers";
import { createSupabaseSourcesBackend, logSourceEvent } from "@/lib/storage/server";
import { youtubeSourcesFromEnv } from "@/server/youtube/service";

// A-04 POST: step=upload_url(서명 업로드 URL 발급) · step=register(업로드 후 등록). 파일 본문은 이 서버를 지나지 않는다.
// source_type=youtube: 영상 1건 URL → video_id·videos.list 동기 검사 → 등록(task-027b, 기능 플래그 YOUTUBE_ENABLED).
// DELETE: 본문 {"source_ids": [...]} 자료 소프트 삭제(task-012).
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const handlers = createSourceHandlers({
    backend: createSupabaseSourcesBackend(await createSupabaseServerClient()),
    youtube: youtubeSourcesFromEnv(),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    log: logSourceEvent,
  });
  return handlers.post(request, projectId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (await sourceReadHandlersForRequest()).deleteSources(request, projectId);
}
