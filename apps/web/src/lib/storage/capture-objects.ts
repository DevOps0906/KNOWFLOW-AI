import type { SupabaseClient } from "@supabase/supabase-js";

// 캡처 객체 경로·삭제(task-030). 자료 삭제 경로(lib/sources/queries.ts)가 쓴다. 사용자 세션으로만 호출한다.

export const CAPTURE_BUCKET = "knowflow-captures";

/** 지우기 전에 그 자료들의 캡처 객체 경로를 모은다(삭제 RPC가 행을 지우면 다시 찾을 수 없다) */
export async function captureObjectPaths(supabase: SupabaseClient, sourceIds: string[]): Promise<string[]> {
  try {
    const { data, error } = await supabase.from("source_captures").select("storage_path").in("source_id", sourceIds);
    if (error || !data) return [];
    return (data as Array<{ storage_path: string }>).map((r) => r.storage_path);
  } catch {
    // 경로를 못 모아도 삭제는 진행한다(남은 객체는 정리 대기열이 지운다)
    return [];
  }
}

/**
 * 행이 지워진 캡처 객체를 지운다(Storage 정책: 쓰기 역할·고아 객체만). 실패해도 자료 삭제는 되돌리지 않는다:
 * 행이 없는 객체는 아무도 읽을 수 없고, DB 정리 대기열(claim_capture_object_trash)에 남는다.
 */
export async function removeCaptureObjects(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(CAPTURE_BUCKET).remove(paths);
  } catch {
    // 정리 대기열이 다시 지운다
  }
}
