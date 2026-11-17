import { LoadingState } from "@/components/states/loading-state";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6 desk:pt-10">
      <LoadingState rows={6} label="자료를 불러오는 중" />
    </div>
  );
}
