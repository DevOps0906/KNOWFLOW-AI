import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaptureStore, ReserveResult } from "@/app/api/sources/[sourceId]/captures/handler";
import { createServiceRoleClient } from "@/server/youtube/service";

// task-030 캡처 서버 동작(service_role): 자리 잡기·업로드·확정·삭제·서명 URL·삭제 대기열 처리.
// 브라우저는 captures 버킷에 직접 접근하지 못한다(authenticated 정책 없음).

const BUCKET = "captures";
const PURGE_BATCH = 100;

/** 서버 스위치. 기본 꺼짐, YOUTUBE_ENABLED와 별개 */
export function isCaptureEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CAPTURE_ENABLED === "true";
}

function reserveError(code: string | undefined): Exclude<ReserveResult, { ok: true }> {
  switch (code) {
    case "P0002":
      return { ok: false, kind: "not_found" };
    case "KF422":
      return { ok: false, kind: "not_youtube" };
    case "KF429":
      return { ok: false, kind: "limit" };
    case "KF409":
      return { ok: false, kind: "conflict" };
    case "22023":
      return { ok: false, kind: "invalid" };
    default:
      return { ok: false, kind: "unknown" };
  }
}

/**
 * 삭제 대기열(capture_purge_queue)을 처리한다: 객체를 지운 경로만 대기열에서 뺀다.
 * Storage remove는 없는 객체를 오류로 보지 않으므로 다시 실행해도 된다. 반환: 처리한 경로 수.
 */
export async function purgeCaptures(admin: SupabaseClient, maxBatches = 10): Promise<number> {
  let done = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await admin.from("capture_purge_queue").select("storage_path").order("queued_at").limit(PURGE_BATCH);
    if (error) throw new Error("purge_queue_read_failed");
    const paths = (data ?? []).map((r: { storage_path: string }) => r.storage_path);
    if (paths.length === 0) break;
    const removed = await admin.storage.from(BUCKET).remove(paths);
    if (removed.error) throw new Error("purge_remove_failed");
    const { error: delError } = await admin.from("capture_purge_queue").delete().in("storage_path", paths);
    if (delError) throw new Error("purge_queue_delete_failed");
    done += paths.length;
    if (paths.length < PURGE_BATCH) break;
  }
  return done;
}

/** 자료·프로젝트 삭제 API 직후 실행. service_role 설정이 없으면 건너뛴다(대기열에 남아 런북으로 처리) */
export async function purgeCapturesFromEnv(): Promise<void> {
  const admin = createServiceRoleClient();
  if (admin) await purgeCaptures(admin);
}

export function createCaptureStore(admin: SupabaseClient): CaptureStore {
  return {
    async reserve(input) {
      const { data, error } = await admin.rpc("reserve_capture", {
        p_source_id: input.sourceId,
        p_user_id: input.userId,
        p_t_seconds: input.tSeconds,
        p_moment_id: input.momentId,
        p_idempotency_key: input.idempotencyKey,
        p_mime: input.mime,
      });
      if (error) return reserveError(error.code);
      const row = data as { capture_id: string; storage_path: string; status: "pending" | "ready"; duplicate: boolean };
      return { ok: true, captureId: row.capture_id, storagePath: row.storage_path, status: row.status, duplicate: row.duplicate };
    },
    async upload(path, bytes, mime) {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true, cacheControl: "0" });
      return !error;
    },
    async confirm(captureId, userId, bytes) {
      const { data, error } = await admin.rpc("confirm_capture", { p_capture_id: captureId, p_user_id: userId, p_bytes: bytes });
      if (error) throw new Error("confirm_failed");
      return data === true;
    },
    async discard(captureId, userId, reason) {
      const { data, error } = await admin.rpc("discard_capture", { p_capture_id: captureId, p_user_id: userId, p_reason: reason });
      if (error) throw new Error("discard_failed");
      return data === true;
    },
    async removeObject(path) {
      const { error } = await admin.storage.from(BUCKET).remove([path]);
      if (!error) return;
      // 직접 삭제가 실패하면 대기열에 다시 넣어 다음 purge가 지운다(행은 이미 없으므로 트리거 경로가 없다)
      const queued = await admin.rpc("enqueue_capture_purge", { p_storage_path: path });
      if (queued.error) throw new Error("enqueue_purge_failed");
    },
    async signUrls(paths) {
      const result = new Map<string, string>();
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(paths, 300);
      if (error || !data) return result;
      for (const item of data) if (item.path && item.signedUrl && !item.error) result.set(item.path, item.signedUrl);
      return result;
    },
    async purge() {
      await purgeCaptures(admin);
    },
  };
}

/** service_role 설정이 없으면 null(핸들러가 503) */
export function captureStoreFromEnv(): CaptureStore | null {
  const admin = createServiceRoleClient();
  return admin ? createCaptureStore(admin) : null;
}
