import { redirect } from "next/navigation";
import { importHref, type ImportTab } from "@/components/import/import-href";
import { SourceImport } from "@/components/import/source-import";
import { loadFolders } from "@/lib/projects/folders";
import { serverSupabaseOrNull } from "@/lib/projects/server";
import { isYoutubeEnabled } from "@/server/youtube/service";

export type ImportSearchParams = Promise<Record<string, string | string[] | undefined>>;

// /new/source(유튜브)·/new/source/pdf(문서) 공용. ?folder=<id>면 그 폴더에 넣는다(모르는 id는 무시하고 기본 폴더).
export async function ImportPage({ tab, searchParams }: { tab: ImportTab; searchParams: ImportSearchParams }) {
  // /new는 proxy 보호 목록(lib/auth/paths.ts)에 없어서 여기서 로그인을 확인한다
  // 설정 누락·조회 실패도 비로그인으로 본다(fail-closed)
  const supabase = await serverSupabaseOrNull();
  if (!supabase) redirect("/login");
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) redirect("/login");
  const params = await searchParams;
  const folderId = typeof params.folder === "string" ? params.folder : undefined;
  const youtubeEnabled = isYoutubeEnabled();
  if (tab === "youtube" && !youtubeEnabled) redirect(importHref(false, folderId));
  const folder = folderId ? ((await loadFolders()) ?? []).find((f) => f.id === folderId) : undefined;
  return <SourceImport tab={tab} youtubeEnabled={youtubeEnabled} folder={folder} />;
}
