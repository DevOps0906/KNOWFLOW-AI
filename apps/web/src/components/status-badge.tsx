import { Check, CircleAlert, Clock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type ProcessingStatus = "ok" | "run" | "fail" | "wait";

const STATUS = {
  ok: { label: "완료", Icon: Check },
  run: { label: "처리 중", Icon: LoaderCircle },
  fail: { label: "실패", Icon: CircleAlert },
  wait: { label: "대기", Icon: Clock },
} as const;

// 처리 상태 배지. 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다.
export function StatusBadge({ status }: { status: ProcessingStatus }) {
  const { label, Icon } = STATUS[status];
  return (
    <Badge variant={status}>
      <Icon aria-hidden className={status === "run" ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}
