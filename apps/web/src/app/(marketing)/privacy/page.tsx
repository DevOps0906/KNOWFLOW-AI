import type { Metadata } from "next";
import { LegalSection, LegalShell, RightsContact } from "../terms/legal-parts";
import { getRightsContactEmail } from "../terms/rights-contact";

export const metadata: Metadata = { title: "개인정보처리방침(초안) · KNOWFLOW-AI" };

export default function PrivacyPage() {
  const email = getRightsContactEmail();
  return (
    <LegalShell title="개인정보처리방침" current="privacy">
      <LegalSection id="p-items" title="1. 수집 항목과 목적">
        <p>계정(이메일·표시 이름), 이용자가 올린 자료와 그 분석 결과, 서비스 이용 기록(사용량)을 서비스 제공과 품질 관리를 위해 처리합니다.</p>
      </LegalSection>
      <LegalSection id="p-retention" title="2. 보관과 파기">
        <p>계정과 자료는 이용자가 삭제하거나 탈퇴할 때까지 보관하며, 요청 시 지체 없이 파기합니다.</p>
        <p>유튜브 영상 메타데이터는 YouTube 정책에 따라 주기적으로 다시 확인하고, 기한 안에 확인되지 않거나 영상이 비공개·삭제되면 파기합니다.</p>
      </LegalSection>
      <LegalSection id="p-transfer" title="3. 국외 이전과 처리 위탁">
        <p>
          AI 분석을 위해 자료의 일부 텍스트와 유튜브 영상 URL이 Google(Gemini API 등)로 전송되어 국외에서 처리될 수 있습니다. 이전 항목은 분석 대상 자료 내용이며,
          목적은 요약·답변 생성입니다. 세부 이전 국가·시기·보유 기간은 확정 전 초안입니다.
        </p>
        <p>
          Google의 개인정보 처리는 Google 개인정보처리방침(https://policies.google.com/privacy)을 따르며, YouTube API 서비스를 사용하는 경우 Google 개인정보
          정책이 적용됩니다.
        </p>
      </LegalSection>
      <LegalSection id="p-rights" title="4. 이용자의 권리와 문의">
        <p>이용자는 자신의 정보에 대한 열람·정정·삭제를 요청할 수 있습니다. 권리자의 삭제 요청도 아래 창구로 받습니다.</p>
        <p>
          문의 이메일: <RightsContact email={email} />
        </p>
      </LegalSection>
    </LegalShell>
  );
}
