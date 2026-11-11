import { Skeleton } from "@/components/ui/skeleton";

// S-10 로딩: 머리·원문 스켈레톤
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-4xl min-w-0 flex-col gap-6 p-4 md:p-6">
      <span className="sr-only">원문을 불러오는 중</span>
      <div aria-hidden className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div aria-hidden className="space-y-3 rounded-panel border border-border bg-card p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
