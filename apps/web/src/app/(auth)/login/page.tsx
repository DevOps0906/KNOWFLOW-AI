import type { Metadata } from "next";
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
    </section>
  );
}
