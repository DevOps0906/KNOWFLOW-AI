import { LoadingState } from "@/components/states/loading-state";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <LoadingState rows={5} label="프로젝트를 불러오는 중" />
    </div>
  );
}
