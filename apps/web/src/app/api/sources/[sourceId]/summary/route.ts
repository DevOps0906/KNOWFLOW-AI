import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { createSourceSummaryHandler } from "./handler";

// GET: PDF 자료 요약(유튜브 플래그와 무관). 비활성 자료는 unavailable=true.
// 읽기는 로그인 세션(anon 키 + RLS)으로만 한다. user_id는 넘기지 않는다.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const supabase = await createSupabaseServerClient();
  const handler = createSourceSummaryHandler({
    ...createSupabaseSourceReadBackend(supabase),
    async getSummarySentences(id) {
      const { data, error } = await supabase.from("source_summaries").select("sentences").eq("source_id", id).maybeSingle();
      if (error) throw new Error("summary_read_failed");
      return (data as { sentences: unknown } | null)?.sentences ?? null;
    },
  });
  return handler(request, sourceId);
}
