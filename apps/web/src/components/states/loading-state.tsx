import { Skeleton } from "@/components/ui/skeleton";

// 목록 스켈레톤. 스크린리더에는 "불러오는 중" 한 번만 읽힌다.
export function LoadingState({ rows = 3, label = "불러오는 중" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-3 rounded-panel border border-border bg-card p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-3">
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
    </div>
  );
}
