import { createClient } from "@supabase/supabase-js";
import type { UploadDeps } from "./upload-flow";

// 브라우저 전용. 공개(anon) 키만 쓰고 세션은 저장하지 않는다. 업로드 권한은 서버가 준 일회용 토큰이 준다.
export function browserUploadDeps(): UploadDeps {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    fetch: (input, init) => fetch(input, init),
    async upload(path, token, file) {
      if (!url || !anonKey) return { error: "config" };
      const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await client.storage.from("sources").uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
      return error ? { error: "upload_failed" } : {};
    },
    async hash(file) {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    },
    newKey: () => crypto.randomUUID(),
  };
}
