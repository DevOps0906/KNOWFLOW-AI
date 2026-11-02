import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateCard } from "./empty-state";

export function ErrorState({
  title = "불러오지 못했습니다",
  description = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <StateCard role="alert" tone="danger" icon={<CircleAlert />} title={title} description={description}>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          다시 시도
        </Button>
      ) : null}
    </StateCard>
  );
}
