import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createAuthHandlers, type AuthBackend, type AuthFailureKind } from "./handlers";
import { logAuthEvent } from "./log";

// 서버 전용. anon 키만 사용한다(service_role은 웹에서 쓰지 않는다).
// 예외: server/youtube/service.ts의 등록 RPC 1곳(2026-11-12 사용자 결정)
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = supabaseEnv();
  if (!env) throw new Error("supabase_env_missing");
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다.
        }
      },
    },
  });
}

function classify(error: { code?: string; status?: number } | null): AuthFailureKind | null {
  if (!error) return null;
  switch (error.code) {
    case "invalid_credentials":
    case "email_not_confirmed":
      return "invalid_credentials";
    case "weak_password":
      return "weak_password";
    case "user_already_exists":
    case "email_exists":
      return "already_registered";
    default:
      return "unknown";
  }
}

export function createSupabaseBackend(supabase: SupabaseClient): AuthBackend {
  return {
    async consumeRateLimit(scope, keyHash) {
      const { data, error } = await supabase.rpc("consume_auth_rate_limit", { p_scope: scope, p_key_hash: keyHash });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) throw new Error("rate_limit_rpc_failed");
      return { allowed: Boolean(row.allowed), retryAfter: Number(row.retry_after) || 0 };
    },
    async signUp(email, password) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { failure: classify(error), hasSession: false };
      // 이메일 확인이 켜진 프로젝트는 기존 계정에 대해 오류 대신 identities가 빈 사용자를 돌려준다
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { failure: "already_registered", hasSession: false };
      }
      return { failure: null, hasSession: Boolean(data.session) };
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { failure: classify(error) };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async requestPasswordReset(email, redirectTo) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error("reset_failed");
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      return { failure: classify(error) };
    },
    async getUserId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  };
}

/** 라우트 핸들러용 조립. 요청마다 쿠키에 묶인 클라이언트를 만든다. */
export async function authHandlersForRequest() {
  const env = supabaseEnv();
  const backend = env
    ? createSupabaseBackend(await createSupabaseServerClient())
    : (null as unknown as AuthBackend);
  return createAuthHandlers({
    backend,
    secret: env ? process.env.AUTH_RATE_LIMIT_SECRET : undefined,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    log: logAuthEvent,
  });
}
