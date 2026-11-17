import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인 · KNOWFLOW-AI" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <section aria-labelledby="login-title" className="flex flex-col gap-6">
      <div>
        <h1 id="login-title" className="text-h1 font-bold">
          로그인
        </h1>
        <p className="mt-2 text-body text-muted-foreground break-keep">계정으로 들어가기</p>
      </div>
      <LoginForm next={next ? safeNextPath(next) : undefined} />
      <nav aria-label="약관" className="flex flex-wrap gap-4 text-caption text-muted-foreground">
        <Link href="/intro" className="underline underline-offset-4">
          서비스 소개
        </Link>
        <Link href="/terms" className="underline underline-offset-4">
          이용약관
        </Link>
        <Link href="/privacy" className="underline underline-offset-4">
          개인정보처리방침
        </Link>
      </nav>
    </section>
  );
}
