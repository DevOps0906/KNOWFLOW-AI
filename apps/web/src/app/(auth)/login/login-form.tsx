"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postAuth } from "../auth-client";
import { Field, FormMessage, retryText } from "../form-parts";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    const result = await postAuth("/api/auth/login", {
      email: form.get("email"),
      password: form.get("password"),
      next,
    });
    if (result.ok) {
      router.replace(result.redirectTo ?? "/dashboard");
      router.refresh();
      return;
    }
    setError(retryText(result.message, result.retryAfter) ?? "로그인하지 못했습니다.");
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate={false}>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Field id="email" label="이메일" type="email" autoComplete="email" inputMode="email" />
      <Field id="password" label="비밀번호" type="password" autoComplete="current-password" />
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? "로그인 중..." : "로그인"}
      </Button>
      <nav aria-label="계정 도움말" className="flex flex-wrap justify-between gap-2 text-caption">
        <Link href="/signup" className="text-primary underline underline-offset-4">
          가입하기
        </Link>
        <Link href="/reset-password" className="text-primary underline underline-offset-4">
          비밀번호 재설정
        </Link>
      </nav>
    </form>
  );
}
