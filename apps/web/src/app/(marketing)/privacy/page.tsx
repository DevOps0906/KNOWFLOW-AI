import type { Metadata } from "next";
import { LegalShell, Pending, RightsContact, Section, rightsContactEmail } from "../terms/legal";

export const metadata: Metadata = { title: "개인정보처리방침 · KNOWFLOW-AI" };
// 권리자 신고 이메일은 배포 환경 설정값을 요청 때 읽는다
export const dynamic = "force-dynamic";

const LIST = "list-disc space-y-1 pl-5";

const TRANSFERS = [
  {
    to: "Google LLC — YouTube Data API",
    items: "영상 ID",
    purpose: "영상 제목·채널·길이 확인과 공개 여부 재확인",
  },
  {
    to: "Google LLC — Gemini API",
    items: "영상 주소, 분석할 자료의 텍스트",
    purpose: "영상 내용 분석(전사·장면 정리)과 요약",
  },
];

export default function PrivacyPage() {
  return (
    <LegalShell title="개인정보처리방침" other={{ href: "/terms", label: "이용약관 보기" }}>
      <Section id="collect" title="1. 수집하는 정보">
        <ul className={LIST}>
          <li>계정: 이메일, 비밀번호(인증 서비스가 암호화해 보관), 표시 이름</li>
          <li>이용자가 등록한 자료: PDF 파일, 가져온 웹 페이지 텍스트, YouTube 영상 주소와 영상 정보(제목·채널·길이)</li>
          <li>처리 결과: 자료를 나눈 조각, 검색용 색인, 장면 정보, 요약, 질문과 답변, 리포트</li>
          <li>이용 기록: 이용 한도 계산을 위한 사용량, 오류 기록(자료 본문은 기록하지 않음)</li>
        </ul>
      </Section>

      <Section id="purpose" title="2. 이용 목적">
        <ul className={LIST}>
          <li>회원 확인과 로그인, 이용 한도 관리</li>
          <li>자료 분석·검색, 근거가 연결된 답변과 리포트 제공</li>
          <li>오류 대응과 서비스 안전성 확보</li>
        </ul>
      </Section>

      <Section id="ai" title="3. AI 처리">
        <p>
          자료 분석과 답변 생성을 위해 자료 텍스트 일부를 외부 AI 서비스로 보냅니다. 보낸 데이터가 AI 학습에 쓰이는지와 공급자 쪽 보관 기간은{" "}
          <Pending />입니다.
        </p>
      </Section>

      <Section id="transfer" title="4. 국외 이전">
        <p>YouTube 영상 기능을 쓰면 다음 정보가 국외로 이전됩니다.</p>
        <ul className="flex flex-col gap-3">
          {TRANSFERS.map((t) => (
            <li key={t.to} className="min-w-0 rounded-panel border border-border bg-card p-4 md:p-6">
              <p className="font-semibold break-keep">{t.to}</p>
              <dl className="mt-2 grid gap-1 md:grid-cols-[auto_1fr] md:gap-x-4">
                <dt className="text-muted-foreground">이전 항목</dt>
                <dd>{t.items}</dd>
                <dt className="text-muted-foreground">목적</dt>
                <dd>{t.purpose}</dd>
                <dt className="text-muted-foreground">이전 국가</dt>
                <dd>
                  <Pending />
                </dd>
                <dt className="text-muted-foreground">일시·방법</dt>
                <dd>기능을 쓸 때마다 암호화된 네트워크로 전송</dd>
                <dt className="text-muted-foreground">보유 기간</dt>
                <dd>
                  <Pending />
                </dd>
              </dl>
            </li>
          ))}
        </ul>
        <p>
          그 밖의 처리 위탁(호스팅 등)과 관련 법령 조항은 <Pending />입니다. 이전을 원하지 않으면 YouTube 영상 기능을 쓰지 않으면 됩니다.
        </p>
        <p>
          Google의 개인정보 처리는{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Google 개인정보처리방침
          </a>
          을 따릅니다.
        </p>
      </Section>

      <Section id="retention" title="5. 보유 기간과 파기">
        <ul className={LIST}>
          <li>자료를 삭제하면 처리 결과와 함께 파기합니다. 탈퇴 시 계정과 자료를 파기합니다.</li>
          <li>YouTube 영상 정보는 정기적으로 다시 확인하고, 확인되지 않으면 파기합니다.</li>
          <li>항목별 세부 보유 기간은 <Pending />입니다.</li>
        </ul>
      </Section>

      <Section id="rights" title="6. 이용자의 권리">
        <p>이용자는 자기 정보의 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 요청 창구와 처리 기한은 <Pending />입니다.</p>
      </Section>

      <Section id="security" title="7. 안전성 확보 조치">
        <ul className={LIST}>
          <li>자기 자료만 볼 수 있도록 데이터베이스에서 접근을 제한합니다.</li>
          <li>전송 구간을 암호화하고, 서버 키는 서버에만 둡니다.</li>
        </ul>
      </Section>

      <Section id="contact" title="8. 개인정보 보호책임자와 권리자 신고">
        <p>
          개인정보 보호책임자는 <Pending />입니다. 저작권 등 권리 침해 신고는 아래 이메일로 받습니다.
        </p>
        <RightsContact email={rightsContactEmail()} />
      </Section>
    </LegalShell>
  );
}
