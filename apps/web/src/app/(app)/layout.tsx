import { AppShell } from "@/components/app-shell/app-shell";
import { ThemeProvider } from "@/components/app-shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { loadFolders } from "@/lib/projects/folders";
import { isYoutubeEnabled } from "@/server/youtube/service";

// 사용자·사용량은 인증·데이터 연동 작업에서 채운다. 폴더(projects)는 사이드바·가져오기에 쓰고, 못 읽으면 빈 목록.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const folders = (await loadFolders()) ?? [];
  return (
    <ThemeProvider>
      <AppShell folders={folders} youtubeEnabled={isYoutubeEnabled()}>
        {children}
      </AppShell>
      <Toaster />
    </ThemeProvider>
  );
}
