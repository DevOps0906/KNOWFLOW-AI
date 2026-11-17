import { Skeleton } from "@/components/ui/skeleton";

// 자료 결과 로딩(전체 폭, 앱 사이드바 없음): 목차 · 제목·자료 카드·본문
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="min-h-dvh bg-background">
      <span className="sr-only">자료를 불러오는 중</span>
      <div className="mx-auto grid w-full grid-cols-1 gap-6 px-4 pt-14 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6 desk:grid-cols-[minmax(0,1fr)_minmax(0,var(--container-reading))_minmax(0,1fr)]">
        <div aria-hidden className="hidden flex-col gap-3 md:flex desk:w-full desk:max-w-60 desk:justify-self-end">
          <Skeleton className="h-7 w-40 rounded-control" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div aria-hidden className="flex w-full flex-col gap-6 md:max-w-reading">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-20 w-full rounded-panel" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
