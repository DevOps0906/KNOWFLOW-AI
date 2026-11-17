"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes는 깜빡임 방지용 인라인 <script>를 클라이언트 렌더에서도 내보내고, React 19는 그때 경고한다.
// 스크립트는 서버 HTML에서만 실행되면 되므로 브라우저에서는 실행되지 않는 타입으로 바꿔 경고 대상에서 뺀다.
const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

// 라이트 기본, 다크는 사용자가 토글할 때만(시스템 설정은 따르지 않는다).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      scriptProps={scriptProps}
    >
      {children}
    </NextThemesProvider>
  );
}
