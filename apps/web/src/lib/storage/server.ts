import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSourceHandlers, type RegisterKind, type SourceAuditEvent, type SourcesBackend } from "./handlers";

const BUCKET = "sources";
const HEAD_BYTES = 1024;

function classify(error: { code?: string }): RegisterKind {
  switch (error.code) {
    case "28000":
      return "unauthorized";
    case "P0002":
      return "not_found";
    case "22023":
      return "invalid";
    case "KF429":
      return "limit";
    case "KF409":
    case "KF410":
      return "conflict";
    case "KF413":
      return "too_large";
    case "KF415":
      return "unsupported";
    default:
      return "unknown";
  }
}

/** 서명 URL로 객체 앞부분만 읽는다. Range를 무시하는 응답이어도 본문을 끝까지 받지 않는다. */
async function readHeadViaSignedUrl(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false as const, kind: "missing" as const };
  let response: Response;
  try {
    response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, cache: "no-store" });
  } catch {
    return { ok: false as const, kind: "error" as const };
  }
  if (response.status === 404 || response.status === 400) return { ok: false as const, kind: "missing" as const };
  if (!response.ok || !response.body) return { ok: false as const, kind: "error" as const };

  const range = response.headers.get("content-range")?.match(/\/(\d+)$/);
  const length = Number(response.headers.get("content-length"));
  const size = range ? Number(range[1]) : response.status === 200 && Number.isFinite(length) && length > 0 ? length : null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => {});
  const head = new Uint8Array(Math.min(received, HEAD_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const room = head.length - offset;
    if (room <= 0) break;
    head.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }
  return { ok: true as const, size, head };
}

export function createSupabaseSourcesBackend(supabase: SupabaseClient): SourcesBackend {
  return {
    async getUserId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    async projectExists(projectId) {
      // RLS: 본인·삭제되지 않은 프로젝트만 보인다
      const { data, error } = await supabase.from("projects").select("id").eq("id", projectId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error("project_lookup_failed");
      return Boolean(data);
    },
    async createUploadUrl(path) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) return { ok: false };
      return { ok: true, token: data.token, signedUrl: data.signedUrl };
    },
    readHead: (path) => readHeadViaSignedUrl(supabase, path),
    async register(input) {
      const { data, error } = await supabase.rpc("register_pdf_source", {
        p_project_id: input.projectId,
        p_title: input.title,
        p_storage_path: input.path,
        p_content_hash: input.contentHash,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
      });
      if (error) return { ok: false, kind: classify(error) };
      const row = data as { source_id: string; job_id: string | null; duplicate: boolean };
      return { ok: true, sourceId: row.source_id, jobId: row.job_id, duplicate: row.duplicate };
    },
  };
}

// 감사 로그: 허용한 필드만 JSON 한 줄로 남긴다(파일명·본문·토큰 없음).
export function logSourceEvent(event: SourceAuditEvent) {
  const { event: name, outcome, reason, userId, projectId, count } = event;
  console.info(JSON.stringify({ type: "source_event", at: new Date().toISOString(), event: name, outcome, reason, userId, projectId, count }));
}

export async function sourceHandlersForRequest() {
  const supabase = await createSupabaseServerClient();
  return createSourceHandlers({
    backend: createSupabaseSourcesBackend(supabase),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    log: logSourceEvent,
  });
}
