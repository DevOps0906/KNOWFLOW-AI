import { LoadingState } from "@/components/states/loading-state";
import { Skeleton } from "@/components/ui/skeleton";

// S-08 로딩: 패널별 스켈레톤. 폭에 따라 보이는 패널 수만 다르다(CSS만, 서버 렌더).
export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6 desk:p-4">
      <div aria-hidden className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-(--grid-workspace-tablet) desk:grid-cols-(--grid-workspace-desk)">
        <div className="md:hidden desk:block">
          <LoadingState rows={4} label="워크스페이스를 불러오는 중" />
        </div>
        <div aria-hidden className="hidden space-y-3 rounded-panel border border-border bg-card p-4 md:block">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div aria-hidden className="hidden space-y-3 rounded-panel border border-border bg-card p-4 md:block">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
    </div>
  );
}
