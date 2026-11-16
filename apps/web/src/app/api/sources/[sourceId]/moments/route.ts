import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { isYoutubeEnabled } from "@/server/youtube/service";
import { createMomentsHandler, type MomentRow, type MomentsBackend, type SummaryRow } from "./handler";

// A-07 GET: 유튜브 요약·장면 카드(L0). 읽기는 세션 RLS로만 한다.
function createSupabaseMomentsBackend(supabase: SupabaseClient): MomentsBackend {
  const base = createSupabaseSourceReadBackend(supabase);
  return {
    getUserId: base.getUserId,
    getSource: base.getSource,
    async getMoments(sourceId) {
      const { data, error } = await supabase
        .from("source_moments")
        .select("id, moment_index, locator, title, description")
        .eq("source_id", sourceId)
        .order("moment_index", { ascending: true });
      if (error) throw new Error("moments_read_failed");
      return (data ?? []) as MomentRow[];
    },
    async getSummary(sourceId) {
      const { data, error } = await supabase.from("source_summaries").select("sentences, model").eq("source_id", sourceId).maybeSingle();
      if (error) throw new Error("summary_read_failed");
      return (data as SummaryRow | null) ?? null;
    },
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const handler = createMomentsHandler({
    backend: createSupabaseMomentsBackend(await createSupabaseServerClient()),
    enabled: isYoutubeEnabled,
  });
  return handler(request, sourceId);
}
