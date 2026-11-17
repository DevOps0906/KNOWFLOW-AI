import type { Metadata } from "next";
import {
  AskSection,
  CtaSection,
  EvidenceSection,
  Hero,
  ImportSection,
  IntroFooter,
  IntroHeader,
  LibrarySection,
  PrivacyNotice,
  ReportSection,
} from "@/components/marketing/intro-sections";

export const metadata: Metadata = {
  alternates: { canonical: "/intro" },
  title: "KNOWFLOW-AI — 자료로 답하는 지식 워크스페이스",
  description: "PDF와 웹 자료에 근거해 묻고, 출처가 연결된 리포트를 만드는 서비스를 준비하고 있습니다.",
};

export default function LandingPage() {
  return (
    <>
      <IntroHeader />
      <main className="min-w-0">
        <Hero />
        <ImportSection />
        <EvidenceSection />
        <ReportSection />
        <AskSection />
        <LibrarySection />
        <CtaSection />
        <PrivacyNotice />
      </main>
      <IntroFooter />
    </>
  );
}
