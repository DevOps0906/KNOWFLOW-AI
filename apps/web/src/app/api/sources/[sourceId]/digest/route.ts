import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { DigestRow, LatestIngest } from "@/lib/sources/digest";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { createSourceDigestHandler } from "./handler";

// GET: 자료 다이제스트(유튜브·PDF, 유튜브 플래그와 무관). 비활성 자료는 unavailable=true.
// 읽기는 로그인 세션(anon 키 + RLS)으로만 한다. user_id는 넘기지 않는다.
export async function GET(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const supabase = await createSupabaseServerClient();
  const handler = createSourceDigestHandler({
    ...createSupabaseSourceReadBackend(supabase),
    async getDigestRow(id) {
      const { data, error } = await supabase.from("source_digests").select("job_id, status, digest").eq("source_id", id).maybeSingle();
      if (error) throw new Error("digest_read_failed");
      return (data as DigestRow | null) ?? null;
    },
    async getLatestIngest(id) {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("id, finished_at")
        .eq("source_id", id)
        .eq("job_type", "source_ingest")
        .eq("status", "succeeded")
        .order("finished_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("latest_ingest_read_failed");
      return (data as LatestIngest | null) ?? null;
    },
  });
  return handler(request, sourceId);
}
