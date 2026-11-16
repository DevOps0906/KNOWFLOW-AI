import Link from "next/link";

export function LegalShell({
  title,
  current,
  children,
}: {
  title: string;
  current: "terms" | "privacy";
  children: React.ReactNode;
}) {
  const other = current === "terms" ? { href: "/privacy", label: "개인정보처리방침" } : { href: "/terms", label: "이용약관" };
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
        <nav aria-label="breadcrumb" className="text-caption text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            홈
          </Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{title}</span>
        </nav>
        <h1 className="mt-4 text-h1 font-bold md:text-display break-keep">{title}</h1>
        <p role="note" className="mt-4 rounded-panel bg-muted p-4 text-body font-semibold break-keep">
          초안 — 이 문서는 검토 전 초안이며 공개 배포 전에 확정됩니다. 내용은 바뀔 수 있습니다.
        </p>
        <div className="mt-8 flex flex-col gap-8">{children}</div>
        <nav aria-label="관련 문서" className="mt-12 flex flex-wrap items-center gap-4 text-body">
          <Link href={other.href} className="underline underline-offset-4">
            {other.label}
          </Link>
          <Link href="/" className="underline underline-offset-4">
            이전으로
          </Link>
        </nav>
      </main>
    </>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-h2 font-semibold break-keep">
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-2 text-body text-muted-foreground break-keep">{children}</div>
    </section>
  );
}

export function RightsContact({ email }: { email: string | null }) {
  return email ? (
    <a href={`mailto:${email}`} className="underline underline-offset-4">
      {email}
    </a>
  ) : (
    <span>준비 중</span>
  );
}
