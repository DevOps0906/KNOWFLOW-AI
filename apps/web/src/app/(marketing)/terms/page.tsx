import type { Metadata } from "next";
import { LegalSection, LegalShell, RightsContact } from "./legal-parts";
import { getRightsContactEmail } from "./rights-contact";

export const metadata: Metadata = { title: "이용약관(초안) · KNOWFLOW-AI" };

export default function TermsPage() {
  const email = getRightsContactEmail();
  return (
    <LegalShell title="이용약관" current="terms">
      <LegalSection id="t-service" title="1. 서비스">
        <p>KNOWFLOW-AI는 이용자가 올린 PDF와 웹·유튜브 자료를 분석해 자료에 근거한 답변과 출처가 연결된 리포트를 제공하는 서비스입니다.</p>
        <p>AI 답변에는 오류가 있을 수 있으며, 중요한 판단 전에는 출처를 직접 확인해야 합니다.</p>
      </LegalSection>
      <LegalSection id="t-content" title="2. 이용자 자료">
        <p>이용자는 자료를 올릴 권리가 있는 경우에만 등록해야 하며, 타인의 권리를 침해하는 자료를 등록해서는 안 됩니다.</p>
        <p>이용자의 자료는 본인에게만 보이며, 이용자가 삭제를 요청하면 서비스 정책에 따라 파기합니다.</p>
      </LegalSection>
      <LegalSection id="t-youtube" title="3. YouTube 서비스 약관 고지">
        <p>유튜브 영상 기능은 YouTube API 서비스를 사용하며, 이용자는 YouTube 서비스 약관(https://www.youtube.com/t/terms)에 동의한 것으로 봅니다.</p>
        <p>영상은 YouTube 공식 플레이어로만 재생하며, 영상 원본은 저장하지 않습니다. 영상이 비공개·삭제되면 해당 자료는 사용할 수 없게 되고 관련 데이터는 파기됩니다.</p>
      </LegalSection>
      <LegalSection id="t-rights" title="4. 권리자 삭제 요청">
        <p>자신의 권리가 침해되었다고 판단하는 권리자는 대상 영상 URL과 권리 관계를 적어 아래 창구로 삭제를 요청할 수 있습니다.</p>
        <p>
          신고 이메일: <RightsContact email={email} />
        </p>
        <p>확인 후 해당 영상의 모든 이용자 자료를 사용할 수 없게 하고 파생 데이터를 삭제한 뒤 회신합니다.</p>
      </LegalSection>
      <LegalSection id="t-change" title="5. 약관 변경">
        <p>약관은 서비스 정식 공개 전에 확정되며, 변경 시 서비스 안에서 알립니다.</p>
      </LegalSection>
    </LegalShell>
  );
}
