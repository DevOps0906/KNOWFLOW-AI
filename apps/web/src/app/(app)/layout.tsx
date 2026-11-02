import { AppShell } from "@/components/app-shell/app-shell";
import { ThemeProvider } from "@/components/app-shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";

// 사용자·사용량은 인증·데이터 연동 작업에서 채운다.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AppShell>{children}</AppShell>
      <Toaster />
    </ThemeProvider>
  );
}
