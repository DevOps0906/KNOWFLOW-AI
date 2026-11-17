import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Serif_KR, Playfair_Display } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/app-shell/theme-provider";

// 서체: Inter(라틴) → Pretendard(한글) 순서. 변수 이름은 tokens.css --font-sans가 참조한다.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// 제목 세리프(Playfair+Noto Serif KR)·메타 모노(JetBrains Mono). 필요한 weight만.
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-playfair", display: "swap" });
const notoSerifKr = Noto_Serif_KR({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-noto-serif-kr", display: "swap", preload: false });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = { title: "KNOWFLOW-AI" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${inter.variable} ${playfair.variable} ${notoSerifKr.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-background text-foreground font-sans">
        {/* 테마는 루트에 한 번만 둔다. 스크립트 태그 경고 대응은 theme-provider.tsx 참고 */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
