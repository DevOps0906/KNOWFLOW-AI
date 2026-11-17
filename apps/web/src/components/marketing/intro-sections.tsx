import Link from "next/link";
import { PreorderCta } from "@/app/(marketing)/preorder-cta";

const BTN =
  "inline-flex h-12 items-center justify-center rounded-pill px-6 text-body font-semibold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Soon() {
  return (
    <span className="ml-2 rounded-tag bg-marker px-1.5 py-0.5 font-mono text-label font-medium text-marker-fg">곧 지원</span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-label tracking-wide text-olive uppercase">{children}</p>;
}

export function IntroHeader() {
  return (
    <header className="bg-section-1">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <span className="font-serif text-h2 font-bold text-heading">KNOWFLOW-AI</span>
        <nav aria-label="시작" className="flex items-center gap-2">
          <Link href="/login" className={`${BTN} h-10 px-4 text-foreground hover:bg-muted`}>
            로그인
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="bg-section-1 py-16 md:py-28 desk:py-36">
      <div className="mx-auto max-w-7xl px-4 text-center md:px-8">
        <h1 id="hero-title" className="font-serif text-intro-display font-bold break-keep text-heading">
          자료로 답하는 <mark className="rounded-tag bg-marker px-2 text-marker-fg">지식 워크스페이스</mark>
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-intro-lead text-olive break-keep">
          한국어 자료를 조사하는 분을 위해, 가져온 자료를 읽기 쉬운 다이제스트로 정리하고 근거가 연결된 답을 만들어 갑니다.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 md:flex-row">
          <Link href="/signup" className={`${BTN} bg-primary text-primary-foreground hover:brightness-110`}>
            시작하기
          </Link>
          <Link href="/login" className={`${BTN} border border-line bg-card text-foreground hover:bg-muted`}>
            로그인
          </Link>
        </div>
        <div
          aria-hidden="true"
          className="mx-auto mt-12 grid max-w-4xl gap-4 rounded-card border border-line bg-card p-4 text-left shadow-panel md:grid-cols-2 md:p-6"
        >
          <div className="rounded-panel border border-line bg-section-2 p-4">
            <p className="font-mono text-label text-olive">가져오기</p>
            <div className="mt-3 rounded-control border border-input bg-card px-4 py-3 text-body text-muted-foreground">
              PDF 파일을 끌어 놓기
            </div>
            <div className="mt-3 flex gap-2">
              <span className="rounded-pill bg-primary px-3 py-1 text-label text-primary-foreground">PDF</span>
              <span className="rounded-pill bg-muted px-3 py-1 text-label text-muted-foreground">유튜브</span>
              <span className="rounded-pill bg-muted px-3 py-1 text-label text-muted-foreground">웹</span>
            </div>
          </div>
          <div className="rounded-panel border border-line bg-section-1 p-4">
            <p className="font-mono text-label text-olive">다이제스트</p>
            <p className="mt-3 font-serif text-h2 font-semibold text-heading">핵심 요약</p>
            <div className="mt-3 h-2 w-full rounded-pill bg-muted" />
            <div className="mt-2 h-2 w-4/5 rounded-pill bg-muted" />
            <div className="mt-2 h-2 w-3/5 rounded-pill bg-muted" />
          </div>
        </div>
      </div>
    </section>
  );
}

const SOURCES = [
  { name: "PDF", body: "논문·보고서·계약서 같은 PDF를 올려 두면 장과 절로 나눠 읽기 쉽게 정리합니다.", soon: false },
  { name: "유튜브", body: "영상 자막을 자료로 가져와 같은 방식으로 정리하는 기능을 준비하고 있습니다.", soon: true },
  { name: "웹 페이지", body: "주소를 붙여 넣어 기사와 문서를 자료로 모으는 기능을 준비하고 있습니다.", soon: true },
];

export function ImportSection() {
  return (
    <section aria-labelledby="import-title" className="bg-section-2 py-16 md:py-28">
      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <Eyebrow>가져오기</Eyebrow>
        <h2 id="import-title" className="mt-3 font-serif text-intro-title font-bold break-keep text-heading">
          흩어진 자료를 한곳으로
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {SOURCES.map((s) => (
            <li key={s.name} className="min-w-0 rounded-card border border-line bg-card p-6">
              <h3 className="text-h2 font-semibold text-heading">
                {s.name}
                {s.soon && <Soon />}
              </h3>
              <p className="mt-2 text-body text-muted-foreground break-keep">{s.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function EvidenceSection() {
  return (
    <section aria-labelledby="evidence-title" className="bg-section-1 py-16 md:py-28">
      <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 md:grid-cols-2 md:px-8">
        <div>
          <Eyebrow>근거</Eyebrow>
          <h2 id="evidence-title" className="mt-3 font-serif text-intro-title font-bold break-keep text-heading">
            근거를 눌러 원문에서 확인
          </h2>
          <p className="mt-4 text-body text-olive break-keep">
            다이제스트의 문장마다 인용 칩이 붙습니다. 칩을 누르면 원문의 해당 위치가 하이라이트로 열립니다. 근거를 찾지
            못한 내용은 &lsquo;근거 없음&rsquo;으로 표시합니다.
          </p>
        </div>
        <div aria-hidden="true" className="rounded-card border border-line bg-card p-6">
          <p className="text-body text-foreground break-keep">
            매출 증가의 주된 원인은 신규 고객 유입이었다.
            <span className="ml-1 rounded-pill bg-muted px-2 py-0.5 font-mono text-label text-olive">p.12</span>
          </p>
          <p className="mt-4 rounded-row bg-section-3 p-3 text-body text-muted-foreground break-keep">
            &hellip; <mark className="bg-highlight text-highlight-fg">신규 고객 유입이 전체 증가분의 대부분을 차지했다</mark>{" "}
            &hellip;
          </p>
        </div>
      </div>
    </section>
  );
}

const REPORTS = [
  { title: "핵심 정리", body: "자료 한 건의 핵심 주장과 결론을 한 쪽 분량으로 모아 줍니다." },
  { title: "비교 정리", body: "여러 자료의 같은 항목을 나란히 놓고 차이를 보여 줍니다." },
  { title: "딥 리서치", body: "질문 하나를 여러 자료에서 찾아 출처가 달린 보고서로 엮습니다." },
];

export function ReportSection() {
  return (
    <section aria-labelledby="report-title" className="bg-section-3 py-16 md:py-28">
      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <Eyebrow>
          리포트
          <Soon />
        </Eyebrow>
        <h2 id="report-title" className="mt-3 font-serif text-intro-title font-bold break-keep text-heading">
          자료에서 출처 달린 리포트로
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {REPORTS.map((r) => (
            <li key={r.title} className="min-w-0 rounded-card border border-line bg-card p-6">
              <h3 className="font-serif text-h2 font-semibold text-heading">{r.title}</h3>
              <p className="mt-2 text-body text-muted-foreground break-keep">{r.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const ASK_TABS = ["자료 하나에 묻기", "폴더 전체에 묻기", "근거 없음 안내"];

export function AskSection() {
  return (
    <section aria-labelledby="ask-title" className="bg-section-dark py-16 text-section-dark-fg md:py-28">
      <div className="mx-auto max-w-4xl px-4 md:px-8">
        <p className="font-mono text-label tracking-wide uppercase">
          질문하기
          <Soon />
        </p>
        <h2 id="ask-title" className="mt-3 font-serif text-intro-title font-bold break-keep">
          읽다가 막히면 바로 묻기
        </h2>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="질문 방식">
          {ASK_TABS.map((t, i) => (
            <li
              key={t}
              className={`rounded-pill border border-section-dark-fg px-4 py-2 text-body ${i === 0 ? "bg-section-dark-fg text-section-dark" : ""}`}
            >
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-intro-lead break-keep">
          올려 둔 자료만을 근거로 답하고, 답마다 출처 칩을 붙이는 것을 목표로 합니다.
        </p>
      </div>
    </section>
  );
}

export function LibrarySection() {
  return (
    <section aria-labelledby="library-title" className="bg-section-1 py-16 md:py-28">
      <div className="mx-auto max-w-4xl px-4 md:px-8">
        <Eyebrow>라이브러리</Eyebrow>
        <h2 id="library-title" className="mt-3 font-serif text-intro-title font-bold break-keep text-heading">
          폴더로 모아 정리
        </h2>
        <div aria-hidden="true" className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ul className="rounded-card border border-line bg-section-2 p-4 text-body text-olive">
            <li className="rounded-row bg-accent px-3 py-2 font-semibold text-accent-foreground">시장 조사</li>
            <li className="px-3 py-2">논문 모음</li>
            <li className="px-3 py-2">받은 자료</li>
          </ul>
          <ul className="rounded-card border border-line bg-card p-4 text-body">
            {["2025 업계 보고서.pdf", "고객 인터뷰 정리.pdf", "정책 브리핑.pdf"].map((n) => (
              <li key={n} className="border-b border-line px-3 py-2 last:border-b-0">
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function CtaSection() {
  return (
    <section aria-labelledby="cta-title" className="bg-section-3 py-16 md:py-28">
      <div className="mx-auto max-w-xl px-4 text-center md:px-8">
        <h2 id="cta-title" className="font-serif text-intro-title font-bold break-keep text-heading">
          지금 자료를 올려 보세요
        </h2>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link href="/signup" className={`${BTN} bg-primary text-primary-foreground hover:brightness-110`}>
            시작하기
          </Link>
          <PreorderCta />
          <a href="#privacy" className="text-caption text-olive underline underline-offset-4">
            사전예약 개인정보 수집 안내
          </a>
        </div>
      </div>
    </section>
  );
}

export function PrivacyNotice() {
  const rows: [string, string][] = [
    ["수집 항목", "이메일"],
    ["이용 목적", "서비스 출시와 베타 안내 연락"],
    ["보관 기간", "사전예약 접수 마감일로부터 30일 안에 파기합니다."],
    ["거부할 권리", "수집에 동의하지 않을 수 있으며, 사전예약을 하지 않아도 불이익은 없습니다."],
    [
      "처리와 문의",
      "수집과 보관은 외부 폼 서비스에서 이루어집니다. 삭제 요청과 문의는 사전예약 폼에 적힌 연락처로 받습니다.",
    ],
  ];
  return (
    <section id="privacy" aria-labelledby="privacy-title" className="bg-section-1 py-16 md:py-20">
      <div className="mx-auto max-w-3xl px-4 md:px-8">
        <h2 id="privacy-title" className="text-h2 font-bold text-heading">
          사전예약 개인정보 수집 안내
        </h2>
        <dl className="mt-6 grid gap-4 rounded-panel bg-muted p-6 text-body">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold">{k}</dt>
              <dd className="text-muted-foreground break-keep">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function IntroFooter() {
  return (
    <footer className="bg-footer">
      <div className="mx-auto max-w-5xl px-4 py-8 text-caption text-olive md:px-8">
        <p className="break-keep">AI 답변에는 오류가 있을 수 있습니다. 표시된 기능은 모두 개발 중이며 변경될 수 있습니다.</p>
        <nav aria-label="약관" className="mt-2 flex flex-wrap gap-4">
          <Link href="/terms" className="underline underline-offset-4">
            이용약관
          </Link>
          <Link href="/privacy" className="underline underline-offset-4">
            개인정보처리방침
          </Link>
          <a href="#privacy" className="underline underline-offset-4">
            문의
          </a>
        </nav>
        <p className="mt-2">&copy; KNOWFLOW-AI</p>
      </div>
    </footer>
  );
}
