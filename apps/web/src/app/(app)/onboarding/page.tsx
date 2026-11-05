import type { Metadata } from "next";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "시작하기 · KNOWFLOW-AI" };

// S-05 온보딩: 환영 → 빈 프로젝트 만들기 → 첫 질문 안내. 언제든 건너뛰고 대시보드로 갈 수 있다.
export default function OnboardingPage() {
  return (
    <div className="mx-auto flex max-w-md min-w-0 flex-col gap-6 p-4 md:p-6">
      <OnboardingWizard />
    </div>
  );
}
