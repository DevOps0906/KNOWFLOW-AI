import { Skeleton } from "@/components/ui/skeleton";

// 자료 결과 로딩: 목차 · 리포트(제목·자료 카드·본문) · 채팅 자리
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid h-full min-h-0 grid-cols-1 gap-3 p-4 md:grid-cols-(--grid-workspace-tablet) md:gap-4 md:p-6 desk:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_var(--size-chat)] desk:p-4"
    >
      <span className="sr-only">자료를 불러오는 중</span>
      <div aria-hidden className="hidden flex-col gap-3 desk:flex">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div aria-hidden className="mx-auto flex w-full max-w-reading flex-col gap-6">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-20 w-full rounded-panel" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
      <Skeleton aria-hidden className="hidden h-full rounded-panel md:block" />
    </div>
  );
}
