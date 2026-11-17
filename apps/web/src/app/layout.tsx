import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/app-shell/theme-provider";

// 서체: Inter(라틴) → Pretendard(한글) 순서. 변수 이름은 tokens.css --font-sans가 참조한다.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: "KNOWFLOW-AI" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning className={inter.variable}>
      <body className="bg-background text-foreground font-sans">
        {/* 테마는 루트에 한 번만 둔다: 라우트 그룹 사이 이동 때 다시 마운트되면 next-themes 스크립트 경고가 난다 */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
