import type { Metadata } from "next";
import { PreorderCta } from "./preorder-cta";

export const metadata: Metadata = {
  title: "KNOWFLOW-AI — 자료로 답하는 지식 워크스페이스",
  description: "PDF와 웹 자료에 근거해 묻고, 출처가 연결된 리포트를 만드는 서비스를 준비하고 있습니다.",
};

const FEATURES = [
  {
    title: "자료를 한곳에 모으기",
    body: "PDF와 웹 페이지를 한 프로젝트에 모아 두고 질문할 수 있도록 만들고 있습니다.",
  },
  {
    title: "근거가 연결된 답변",
    body: "답변마다 근거가 된 자료의 위치를 연결해 보여주는 것을 목표로 합니다. 근거를 찾지 못하면 '근거 없음'으로 안내합니다.",
  },
  {
    title: "출처가 있는 리포트",
    body: "출처가 연결된 리포트를 만들고 Markdown으로 내보내는 기능을 준비하고 있습니다.",
  },
];

export default function LandingPage() {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <span className="text-h2 font-bold text-primary">KNOWFLOW-AI</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl min-w-0 px-4 md:px-6">
        <section className="py-12 text-center md:py-20">
          <h1 className="text-display font-bold break-keep">자료로 답하는 지식 워크스페이스</h1>
          <p className="mx-auto mt-4 max-w-reading text-body text-muted-foreground break-keep">
            한국어 자료를 조사하는 분을 위해, PDF와 웹 자료에 근거한 질문과 출처가 연결된 리포트를 만들고 있습니다.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <PreorderCta />
            <a href="#privacy" className="text-caption text-muted-foreground underline underline-offset-4">
              사전예약 개인정보 수집 안내
            </a>
          </div>
        </section>

        <section aria-labelledby="features" className="py-8 md:py-12">
          <h2 id="features" className="text-h1 font-bold">
            만들고 있는 기능
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="min-w-0 rounded-panel border border-border bg-card p-6">
                <h3 className="text-h2 font-semibold break-keep">{f.title}</h3>
                <p className="mt-2 text-body text-muted-foreground break-keep">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="privacy" aria-labelledby="privacy-title" className="py-8 md:py-12">
          <h2 id="privacy-title" className="text-h1 font-bold">
            사전예약 개인정보 수집 안내
          </h2>
          <dl className="mt-6 grid gap-4 rounded-panel bg-muted p-6 text-body">
            <div>
              <dt className="font-semibold">수집 항목</dt>
              <dd className="text-muted-foreground">이메일</dd>
            </div>
            <div>
              <dt className="font-semibold">이용 목적</dt>
              <dd className="text-muted-foreground break-keep">서비스 출시와 베타 안내 연락</dd>
            </div>
            <div>
              <dt className="font-semibold">보관 기간</dt>
              <dd className="text-muted-foreground break-keep">사전예약 접수 마감일로부터 30일 안에 파기합니다.</dd>
            </div>
            <div>
              <dt className="font-semibold">거부할 권리</dt>
              <dd className="text-muted-foreground break-keep">
                수집에 동의하지 않을 수 있으며, 사전예약을 하지 않아도 불이익은 없습니다.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">처리와 문의</dt>
              <dd className="text-muted-foreground break-keep">
                수집과 보관은 외부 폼 서비스에서 이루어집니다. 삭제 요청과 문의는 사전예약 폼에 적힌 연락처로 받습니다.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="mt-8 border-t border-border">
        <div className="mx-auto max-w-5xl px-4 py-6 text-caption text-muted-foreground md:px-6">
          <p className="break-keep">
            AI 답변에는 오류가 있을 수 있습니다. 표시된 기능은 모두 개발 중이며 변경될 수 있습니다.
          </p>
          <p className="mt-2">&copy; KNOWFLOW-AI</p>
        </div>
      </footer>
    </>
  );
}
