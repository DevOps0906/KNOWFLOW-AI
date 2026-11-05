"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { postAuth } from "../auth-client";
import { Field, FormMessage, retryText } from "../form-parts";

export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const result = await postAuth("/api/auth/signup", {
      email: form.get("email"),
      password: form.get("password"),
    });
    if (result.ok && result.redirectTo) {
      router.replace(result.redirectTo);
      router.refresh();
      return;
    }
    if (result.ok) {
      setNotice(result.message ?? "가입 확인 메일을 보냈습니다.");
    } else {
      setError(retryText(result.message, result.retryAfter) ?? "가입하지 못했습니다.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
      <Field id="email" label="이메일" type="email" autoComplete="email" inputMode="email" />
      <Field
        id="password"
        label="비밀번호"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        hint={`${PASSWORD_MIN_LENGTH}자 이상, 문자와 숫자·기호를 함께 사용하세요.`}
      />
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? "가입 중..." : "가입"}
      </Button>
      <p className="text-caption text-muted-foreground">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="text-primary underline underline-offset-4">
          로그인
        </Link>
      </p>
    </form>
  );
}
