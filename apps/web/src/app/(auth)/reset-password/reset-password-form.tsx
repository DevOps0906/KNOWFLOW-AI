"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { postAuth } from "../auth-client";
import { Field, FormMessage, retryText } from "../form-parts";

/** mode=request: 재설정 메일 요청, mode=update: 메일 링크로 들어온 세션에서 새 비밀번호 설정 */
export function ResetPasswordForm({ mode, linkError }: { mode: "request" | "update"; linkError?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(
    linkError ? "재설정 링크가 올바르지 않거나 만료되었습니다. 메일을 다시 요청해 주세요." : undefined,
  );
  const [notice, setNotice] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const result =
      mode === "request"
        ? await postAuth("/api/auth/reset-password", { email: form.get("email") })
        : await postAuth("/api/auth/update-password", { password: form.get("password") });
    if (result.ok && mode === "update") {
      router.replace("/dashboard");
      router.refresh();
      return;
    }
    if (result.ok) setNotice(result.message);
    else setError(retryText(result.message, result.retryAfter) ?? "요청하지 못했습니다. 다시 시도해 주세요.");
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      {mode === "request" ? (
        <Field id="email" label="이메일" type="email" autoComplete="email" inputMode="email" />
      ) : (
        <Field
          id="password"
          label="새 비밀번호"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`${PASSWORD_MIN_LENGTH}자 이상, 문자와 숫자·기호를 함께 사용하세요.`}
        />
      )}
      <div className="flex flex-col gap-3 md:flex-row">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="md:flex-1">
          {pending ? "처리 중..." : mode === "request" ? "메일 보내기" : "비밀번호 변경"}
        </Button>
        <Button asChild variant="outline" size="lg" className="md:flex-1">
          <Link href="/login">{mode === "request" ? "취소" : "로그인으로"}</Link>
        </Button>
      </div>
    </form>
  );
}
