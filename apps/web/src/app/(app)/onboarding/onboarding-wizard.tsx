"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callProjects } from "@/lib/projects/client";

const STEPS = ["환영", "빈 프로젝트 만들기", "첫 질문 안내"] as const;

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await callProjects("POST", "/api/projects", { name });
    setPending(false);
    if (!result.ok) return setError(result.message ?? "프로젝트를 만들지 못했습니다. 건너뛰고 나중에 만들 수도 있습니다.");
    setStep(2);
  }

  return (
    <section aria-labelledby="onboarding-title" className="flex flex-col gap-6">
      <div>
        <p className="text-caption text-muted-foreground" aria-live="polite">
          {step + 1} / {STEPS.length} · {STEPS[step]}
        </p>
        <h1 id="onboarding-title" className="mt-1 text-h1 font-bold break-keep">
          {step === 0 ? "환영합니다" : step === 1 ? "프로젝트 이름을 정해 주세요" : "이제 질문할 준비가 됐습니다"}
        </h1>
      </div>

      {step === 0 ? (
        <>
          <p className="text-body text-muted-foreground break-keep">
            프로젝트는 자료를 모아 질문하고 리포트를 만드는 작업 공간입니다. 먼저 빈 프로젝트 하나를 만들어 볼까요?
          </p>
          <div className="flex flex-col gap-3 md:flex-row">
            <Button size="lg" className="md:flex-1" onClick={() => setStep(1)}>
              다음
            </Button>
            <Button asChild variant="outline" size="lg" className="md:flex-1">
              <Link href="/dashboard">건너뛰기</Link>
            </Button>
          </div>
        </>
      ) : null}

      {step === 1 ? (
        <form onSubmit={create} className="flex flex-col gap-6">
          {error ? (
            <p role="alert" className="rounded-control border border-destructive px-4 py-3 text-body text-destructive break-keep">
              {error}
            </p>
          ) : null}
          <label className="flex flex-col gap-2 text-body font-semibold">
            프로젝트 이름 <span className="sr-only">(필수)</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="off" />
          </label>
          <div className="flex flex-col gap-3 md:flex-row">
            <Button type="button" variant="outline" size="lg" className="md:flex-1" onClick={() => setStep(0)}>
              이전
            </Button>
            <Button type="submit" size="lg" className="md:flex-1" disabled={pending || name.trim().length === 0} aria-busy={pending}>
              {pending ? "만드는 중..." : "다음"}
            </Button>
          </div>
          <Button asChild variant="link" size="sm" className="self-start">
            <Link href="/dashboard">건너뛰기</Link>
          </Button>
        </form>
      ) : null}

      {step === 2 ? (
        <>
          <p className="text-body text-muted-foreground break-keep">
            프로젝트에 PDF나 웹 페이지를 추가하면, 자료에 근거한 답과 출처를 확인할 수 있습니다. 자료 추가 기능은 곧 열립니다.
          </p>
          <Button asChild size="lg">
            <Link href="/dashboard">대시보드로 이동</Link>
          </Button>
        </>
      ) : null}
    </section>
  );
}
