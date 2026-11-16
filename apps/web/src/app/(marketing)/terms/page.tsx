import type { Metadata } from "next";
import { LegalShell, Pending, RightsContact, Section, rightsContactEmail } from "./legal";

export const metadata: Metadata = { title: "이용약관 · KNOWFLOW-AI" };
// 권리자 신고 이메일은 배포 환경 설정값을 요청 때 읽는다
export const dynamic = "force-dynamic";

const LIST = "list-disc space-y-1 pl-5";

export default function TermsPage() {
  return (
    <LegalShell title="이용약관" other={{ href: "/privacy", label: "개인정보처리방침 보기" }}>
      <Section id="purpose" title="1. 목적">
        <p>
          이 약관은 KNOWFLOW-AI(이하 &lsquo;서비스&rsquo;)를 이용하는 조건과 절차, 이용자와 운영자의 권리·의무를 정합니다. 운영 주체와 시행일은{" "}
          <Pending />입니다.
        </p>
      </Section>

      <Section id="service" title="2. 서비스 내용">
        <p>서비스는 이용자가 모은 자료를 분석해 다음 기능을 제공합니다.</p>
        <ul className={LIST}>
          <li>PDF 업로드와 웹 페이지 주소 가져오기, YouTube 영상 주소 등록(기능을 연 경우)</li>
          <li>자료 내용을 나눠 저장하고 검색할 수 있게 만드는 처리</li>
          <li>자료에 근거한 질의응답과 출처가 연결된 리포트 작성</li>
        </ul>
        <p>베타 기간에는 기능·이용 한도가 바뀌거나 중단될 수 있습니다.</p>
      </Section>

      <Section id="materials" title="3. 이용자가 등록한 자료">
        <ul className={LIST}>
          <li>이용자는 자신이 권리를 가졌거나 이용 허락을 받은 자료만 등록합니다.</li>
          <li>등록한 자료의 권리는 이용자 또는 원래 권리자에게 있으며, 서비스는 기능 제공에 필요한 범위에서만 자료를 처리합니다.</li>
          <li>권리 침해 신고가 확인되면 해당 자료를 이용할 수 없게 하고 처리 결과(분석 내용·장면 정보·요약)를 삭제할 수 있습니다.</li>
        </ul>
      </Section>

      <Section id="ai" title="4. AI 처리와 한계">
        <ul className={LIST}>
          <li>자료 분석·답변·리포트는 외부 AI 서비스를 이용해 자동으로 만들어집니다.</li>
          <li>AI 결과에는 오류가 있을 수 있습니다. 중요한 판단 전에는 연결된 출처를 직접 확인해 주세요.</li>
          <li>근거를 찾지 못하면 &lsquo;근거 없음&rsquo;으로 안내합니다.</li>
        </ul>
      </Section>

      <Section id="youtube" title="5. YouTube 관련 고지">
        <p>
          YouTube 영상 기능은 YouTube API 서비스를 사용합니다. 이 기능을 쓰면 이용자는{" "}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            YouTube 서비스 약관
          </a>
          을 따르는 데 동의하게 됩니다. 고지 문구의 세부 요건은 <Pending />입니다.
        </p>
        <p>서비스는 영상을 내려받아 저장하지 않으며, 영상 재생은 YouTube 플레이어로 합니다.</p>
      </Section>

      <Section id="rights" title="6. 권리자 삭제 요청 창구">
        <p>
          자신의 저작물이 서비스에서 권리 없이 처리되고 있다고 판단하면 아래 이메일로 알려 주세요. 확인 뒤 해당 자료를 모든 이용자에게서
          이용할 수 없게 하고 결과를 회신합니다. 처리 기한은 <Pending />입니다.
        </p>
        <RightsContact email={rightsContactEmail()} />
      </Section>

      <Section id="prohibited" title="7. 금지 행위">
        <ul className={LIST}>
          <li>타인의 권리를 침해하는 자료 등록</li>
          <li>서비스 운영을 방해하거나 다른 이용자의 자료에 접근하려는 시도</li>
          <li>자동화 수단으로 이용 한도를 우회하는 행위</li>
        </ul>
      </Section>

      <Section id="liability" title="8. 책임의 한계와 분쟁">
        <p>
          책임 제한 범위와 분쟁 해결 절차, 관할은 <Pending />입니다.
        </p>
      </Section>
    </LegalShell>
  );
}
