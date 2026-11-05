import type { Metadata } from "next";
import { createSupabaseBackend, createSupabaseServerClient, supabaseEnv } from "@/lib/auth/supabase-server";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "비밀번호 재설정 · KNOWFLOW-AI" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string }>;
}) {
  const { mode, error } = await searchParams;
  // 새 비밀번호 설정은 메일 링크로 만들어진 세션이 있을 때만 보인다(없으면 메일 요청 화면)
  let canUpdate = false;
  if (mode === "update" && supabaseEnv()) {
    try {
      canUpdate = Boolean(await createSupabaseBackend(await createSupabaseServerClient()).getUserId());
    } catch {
      canUpdate = false;
    }
  }
  const updating = mode === "update" && canUpdate;

  return (
    <section aria-labelledby="reset-title" className="flex flex-col gap-6">
      <div>
        <h1 id="reset-title" className="text-h1 font-bold">
          비밀번호 재설정
        </h1>
        <p className="mt-2 text-body text-muted-foreground break-keep">
          {updating ? "새 비밀번호를 입력해 주세요." : "가입한 이메일로 재설정 링크를 보내드립니다."}
        </p>
      </div>
      <ResetPasswordForm mode={updating ? "update" : "request"} linkError={error === "link" || (mode === "update" && !canUpdate)} />
    </section>
  );
}
