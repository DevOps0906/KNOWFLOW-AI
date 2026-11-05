import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "가입 · KNOWFLOW-AI" };

export default function SignupPage() {
  return (
    <section aria-labelledby="signup-title" className="flex flex-col gap-6">
      <div>
        <h1 id="signup-title" className="text-h1 font-bold">
          가입
        </h1>
        <p className="mt-2 text-body text-muted-foreground break-keep">새 계정 만들기</p>
      </div>
      <SignupForm />
    </section>
  );
}
