"use client";

import "./globals.css";

// 루트 레이아웃까지 실패했을 때의 최후 화면. 자체 html·body가 필요하고 message는 노출하지 않는다.
// 다크 테마 전환은 루트 레이아웃에 있어 여기서는 라이트로 고정한다.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body className="bg-background text-foreground font-sans">
        <main role="alert" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-3 p-4">
          <h1 className="font-semibold">문제가 생겼습니다</h1>
          <p className="text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
          {error.digest ? <p className="text-caption text-muted-foreground">오류 번호: {error.digest}</p> : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="h-10 rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring bg-primary px-[1.125rem] text-body font-semibold text-primary-foreground"
            >
              다시 시도
            </button>
            <a href="/dashboard" className="text-caption text-muted-foreground underline underline-offset-4">
              처음으로
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
