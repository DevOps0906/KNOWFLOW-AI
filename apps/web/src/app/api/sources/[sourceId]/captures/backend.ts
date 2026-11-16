import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import type { CaptureRow, CapturesBackend } from "./handler";

// 읽기는 로그인 세션(anon 키 + RLS)으로만 한다. 소유·삭제·비활성 판정은 source_captures RLS가 한다.
export function createSessionCapturesBackend(supabase: SupabaseClient): CapturesBackend {
  const sources = createSupabaseSourceReadBackend(supabase);
  return {
    getUserId: () => sources.getUserId(),
    getSource: (id) => sources.getSource(id),
    async listCaptures(sourceId) {
      const { data, error } = await supabase
        .from("source_captures")
        .select("id, moment_id, t_seconds, storage_path, created_at")
        .eq("source_id", sourceId)
        .eq("status", "ready")
        .order("t_seconds", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw new Error("captures_read_failed");
      return (data ?? []) as CaptureRow[];
    },
    async captureVisible(sourceId, captureId) {
      const { data, error } = await supabase.from("source_captures").select("id").eq("source_id", sourceId).eq("id", captureId).maybeSingle();
      if (error) throw new Error("capture_read_failed");
      return Boolean(data);
    },
  };
}
