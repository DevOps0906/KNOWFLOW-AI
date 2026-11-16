import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { isYoutubeEnabled } from "@/server/youtube/service";
import { createMomentsHandler, type MomentRow } from "./handler";

// A-07 GET: 장면 카드(L0)·영상 요약. 플래그 꺼짐 {enabled:false}, 비활성 자료 {unavailable:true}. 읽기는 RLS 세션만.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const supabase = await createSupabaseServerClient();
  const read = createSupabaseSourceReadBackend(supabase);
  const handler = createMomentsHandler({
    youtubeEnabled: isYoutubeEnabled,
    backend: {
      getUserId: () => read.getUserId(),
      getSource: (id) => read.getSource(id),
      getChunks: (input) => read.getChunks(input),
      async listMoments(id) {
        const { data, error } = await supabase
          .from("source_moments")
          .select("id, moment_index, locator, title, description")
          .eq("source_id", id)
          .order("moment_index", { ascending: true });
        if (error) throw new Error("moments_read_failed");
        return (data ?? []) as MomentRow[];
      },
      async getSummarySentences(id) {
        const { data, error } = await supabase.from("source_summaries").select("sentences").eq("source_id", id).maybeSingle();
        if (error) throw new Error("summary_read_failed");
        return (data as { sentences: unknown } | null)?.sentences ?? null;
      },
    },
  });
  return handler(request, sourceId);
}
