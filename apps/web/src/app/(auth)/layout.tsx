import Link from "next/link";

// 인증 화면 공통 레이아웃(S-02~S-04): 전체 화면 중앙 카드. 루트 layout이 html·body를 그린다.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3 md:px-6">
          <Link href="/" className="text-h2 font-bold text-primary">
            KNOWFLOW-AI
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md min-w-0 flex-1 flex-col justify-center px-4 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
