import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readYoutubeConfig, youtubeUsable, type YoutubeConfig } from "./config";
import { createStubMetadataProvider, createYoutubeDataApiProvider } from "./metadata";
import { createYoutubeSources, type RegisterRpcInput, type RegisterRpcResult } from "./register";

/** 플래그·설정을 통과한 뒤에만 불린다. 실제 공급자는 명시적 선택일 때만. */
export function metadataProviderFor(config: YoutubeConfig, fetchImpl: typeof fetch = fetch) {
  return config.provider === "youtube" && config.apiKey
    ? createYoutubeDataApiProvider(config.apiKey, fetchImpl)
    : createStubMetadataProvider();
}

// register_youtube_source는 service_role 전용이다. 세션 소유 확인은 호출 전에 핸들러가 한다.
// SUPABASE_SERVICE_ROLE_KEY는 웹에서 이 함수 한 곳만 읽는다(2026-11-12 사용자 결정, 테스트가 강제).
function serviceRoleEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
}

function currentConfig() {
  return readYoutubeConfig(process.env, serviceRoleEnv() !== null);
}

/** 화면(S-09 탭)용. 플래그가 꺼졌거나 설정이 쓸 수 없으면 false. */
export function isYoutubeEnabled() {
  return youtubeUsable(currentConfig());
}

async function registerViaServiceRole(input: RegisterRpcInput): Promise<RegisterRpcResult> {
  const env = serviceRoleEnv();
  if (!env) return { ok: false, error: null };
  const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("register_youtube_source", {
    p_user_id: input.userId,
    p_project_id: input.projectId,
    p_video_id: input.videoId,
    p_title: input.title,
    p_channel_title: input.channelTitle,
    p_duration_seconds: input.durationSeconds,
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: input.requestHash,
  });
  if (error) return { ok: false, error: { code: error.code, message: error.message, details: error.details, hint: error.hint } };
  const row = data as { source_id: string; job_id: string | null; duplicate: boolean };
  return { ok: true, sourceId: row.source_id, jobId: row.job_id, duplicate: row.duplicate };
}

export function youtubeSourcesFromEnv() {
  return createYoutubeSources({
    config: currentConfig,
    provider: (config) => metadataProviderFor(config),
    register: registerViaServiceRole,
  });
}
