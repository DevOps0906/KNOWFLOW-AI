import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapturesBackend } from "@/app/api/sources/[sourceId]/captures/handler";
import { createSupabaseSourceReadBackend } from "@/lib/sources/queries";
import { CAPTURE_BUCKET } from "./capture-objects";

// L1 캡처 저장소(task-030). 비공개 버킷 knowflow-captures, 경로 = <조직>/<프로젝트>/<자료>/<캡처>.<png|webp>(DB가 정한다).
// 모든 호출은 사용자 세션(anon 키 + RLS·Storage 정책)으로 한다. service_role은 쓰지 않는다.

/** 영상당 캡처 상한(DB create_source_capture와 같은 값) */
export const CAPTURE_LIMIT_PER_VIDEO = 20;
/** 이미지 크기 상한(버킷 file_size_limit·DB 검사와 같은 값). 형식·상한은 팀장 결정 전 초기값 */
export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;

export type CaptureMime = "image/png" | "image/webp";

export interface CaptureRow {
  id: string;
  moment_id: string | null;
  t_seconds: number | string;
  storage_path: string;
  created_at: string;
}

export type CreateCaptureResult =
  | { ok: true; captureId: string; storagePath: string }
  | { ok: false; kind: "unauthorized" | "not_found" | "not_youtube" | "invalid" | "limit" | "locked" | "unknown" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 매직 바이트로 PNG·WebP만 인정한다. 그 밖은 null */
export function sniffCaptureImage(bytes: Uint8Array): CaptureMime | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function createError(error: { code?: string; message?: string }): Exclude<CreateCaptureResult, { ok: true }> {
  switch (error.code) {
    case "28000":
      return { ok: false, kind: "unauthorized" };
    case "P0002":
    case "KF410": // source_unavailable: 비활성 자료는 없는 것으로 다룬다
      return { ok: false, kind: "not_found" };
    case "22023":
      return { ok: false, kind: error.message === "not_youtube_source" ? "not_youtube" : "invalid" };
    case "KF429":
      return { ok: false, kind: "limit" };
    case "KF403":
      return { ok: false, kind: "locked" };
    default:
      return { ok: false, kind: "unknown" };
  }
}

export function createSupabaseCapturesBackend(supabase: SupabaseClient): CapturesBackend {
  const read = createSupabaseSourceReadBackend(supabase);
  return {
    getUserId: () => read.getUserId(),
    getSource: (id) => read.getSource(id),
    async listCaptures(sourceId) {
      const { data, error } = await supabase
        .from("source_captures")
        .select("id, moment_id, t_seconds, storage_path, created_at")
        .eq("source_id", sourceId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error("captures_read_failed");
      return (data ?? []) as CaptureRow[];
    },
    async signUrls(paths, ttlSeconds) {
      const { data, error } = await supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(paths, ttlSeconds);
      if (error || !data) return paths.map(() => null);
      const byPath = new Map(data.map((d) => [d.path, d.error ? null : d.signedUrl]));
      return paths.map((p) => byPath.get(p) ?? null);
    },
    async createCapture({ sourceId, momentId, mime, size }) {
      const { data, error } = await supabase.rpc("create_source_capture", {
        p_source_id: sourceId,
        p_moment_id: momentId,
        p_mime_type: mime,
        p_byte_size: size,
      });
      if (error) return createError(error);
      const row = data as { capture_id: string; storage_path: string };
      return { ok: true, captureId: row.capture_id, storagePath: row.storage_path };
    },
    async upload(path, bytes, mime) {
      try {
        const { error } = await supabase.storage.from(CAPTURE_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        return !error;
      } catch {
        return false;
      }
    },
    async discardCapture(captureId) {
      await supabase.rpc("discard_source_capture", { p_capture_id: captureId });
    },
  };
}
