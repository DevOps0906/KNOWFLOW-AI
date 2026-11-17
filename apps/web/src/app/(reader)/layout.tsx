import { Toaster } from "@/components/ui/sonner";

// 읽기 화면(자료 결과 /sources/[id], docs/digest-contract.md §1): 앱 사이드바 셸 없이 전체 폭.
// (app) 레이아웃의 기본 래퍼(토스트)만 쓴다. 로그인 보호는 (app)과 같이 경로 단위(lib/auth/paths.ts)로 하고, 데이터는 RLS 세션으로 읽는다.
export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
