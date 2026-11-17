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
        {/* 테마는 루트에 한 번만 둔다. 스크립트 태그 경고 대응은 theme-provider.tsx 참고 */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
