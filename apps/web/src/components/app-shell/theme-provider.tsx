"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// 라이트 기본, 다크는 사용자가 토글할 때만(시스템 설정은 따르지 않는다).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
