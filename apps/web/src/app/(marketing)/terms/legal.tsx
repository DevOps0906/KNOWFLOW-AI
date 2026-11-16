import Link from "next/link";
import { BackButton } from "./back-button";

// S-16 이용약관 · S-17 개인정보처리방침 공통 틀(문구 초안, task-029c).

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** 권리자 신고 이메일(서버 설정값). 없거나 형식이 아니면 null → "준비 중" */
export function rightsContactEmail(value: string | undefined = process.env.RIGHTS_CONTACT_EMAIL): string | null {
  const v = value?.trim();
  return v && EMAIL_PATTERN.test(v) ? v : null;
}

export function RightsContact({ email }: { email: string | null }) {
  return (
    <div className="mt-3 rounded-panel bg-muted p-4 md:p-6">
      <p className="font-semibold">권리자 신고 이메일</p>
      {email ? (
        <a href={`mailto:${email}`} className="mt-1 inline-block break-all text-primary underline underline-offset-4">
          {email}
        </a>
      ) : (
        <p className="mt-1 text-muted-foreground">신고 창구 준비 중입니다.</p>
      )}
      <p className="mt-2 text-muted-foreground break-keep">
        요청에는 영상 주소(또는 자료 위치), 권리자임을 확인할 수 있는 정보, 연락처를 적어 주세요.
      </p>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-6 md:py-8">
      <h2 id={id} className="text-h2 font-bold break-keep">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-body break-keep">{children}</div>
    </section>
  );
}

/** 확인이 끝나지 않은 항목 표시 */
export function Pending({ children = "확인 필요" }: { children?: React.ReactNode }) {
  return <span className="rounded-row bg-warning-soft px-1.5 text-warning">{children}</span>;
}

export function LegalShell({
  title,
  other,
  children,
}: {
  title: string;
  other: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/" className="text-h2 font-bold text-primary">
            KNOWFLOW-AI
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-reading min-w-0 px-4 py-8 md:px-6 md:py-12">
        <nav aria-label="현재 위치" className="text-caption text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="underline underline-offset-4">
                홈
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>

        <h1 className="mt-4 text-h1 font-bold break-keep">{title}</h1>
        <p role="note" className="mt-4 rounded-row bg-warning-soft p-3 text-caption text-warning break-keep">
          초안 — 법무 확인 전입니다. 확정 전까지 내용이 바뀔 수 있고, &lsquo;확인 필요&rsquo; 표시 항목은 아직 정해지지 않았습니다.
        </p>

        {children}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <BackButton />
          <Link href={other.href} className="text-body text-primary underline underline-offset-4">
            {other.label}
          </Link>
        </div>
      </main>
    </>
  );
}
