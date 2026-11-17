"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { Clock, EyeOff, FileX, LogIn, SearchX } from "lucide-react";
import { StateCard } from "@/components/states/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/components/workspace/use-polling";
import { processingStatus, type SourceMeta } from "@/components/workspace/viewer/format";
import { isProcessing } from "./types";

export type PollError = "unauthorized" | "not_found" | null;

// 자료 상태: 처리 중이면 A-07 GET을 폴링하고, 끝나면 서버 렌더를 새로 받는다(router.refresh).
// 폴링 중 401(세션 만료)·404(삭제·권한 없음)는 다시 물어도 같으므로 폴링을 멈추고 안내한다.
export function useSourceStatus(initialSource: SourceMeta) {
  const router = useRouter();
  const [source, setSource] = useState(initialSource);
  const [prevInitial, setPrevInitial] = useState(initialSource);
  const [announcement, setAnnouncement] = useState("");
  const [pollError, setPollError] = useState<PollError>(null);

  // 서버가 새로 렌더하면(router.refresh) 그 값으로 바꾼다
  if (initialSource !== prevInitial) {
    setPrevInitial(initialSource);
    setSource(initialSource);
  }

  const sourceId = source.id;
  const refetch = useCallback(async () => {
    const res = await fetch(`/api/sources/${sourceId}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 404) {
      setPollError(res.status === 401 ? "unauthorized" : "not_found");
      setAnnouncement(res.status === 401 ? "로그인이 필요해 상태 확인을 멈췄습니다." : "자료를 찾을 수 없어 상태 확인을 멈췄습니다.");
      return;
    }
    if (!res.ok) throw new Error("source_failed");
    const next = ((await res.json()) as { source: SourceMeta }).source;
    setSource(next);
    if (!isProcessing(next.status)) {
      // 끝났으면 서버 렌더(폴더 정보 포함)를 새로 받는다
      setAnnouncement(next.status === "completed" ? "처리가 끝났습니다. 요약 리포트를 불러옵니다." : "자료를 처리하지 못했습니다.");
      router.refresh();
    }
  }, [sourceId, router]);
  usePolling(isProcessing(source.status) && pollError === null, refetch, source.status);

  const completed = source.status === "completed" && source.unavailable_at === null;
  return { source, completed, pollError, announcement };
}

/** 미완료(처리 중·실패·비활성·폴링 중단) 자료의 상태 카드. action은 "자료 목록으로" 같은 되돌아가기 버튼 */
export function SourceStatusCard({ source, pollError, action }: { source: SourceMeta; pollError: PollError; action: ReactNode }) {
  const isYoutube = source.source_type === "youtube";
  if (pollError === "unauthorized") {
    return (
      <StateCard
        role="alert"
        tone="danger"
        icon={<LogIn />}
        title="다시 로그인해 주세요"
        description="로그인이 끝나 처리 상태를 확인할 수 없습니다. 로그인하면 이 자료로 돌아옵니다."
      >
        <LoginButton sourceId={source.id} />
      </StateCard>
    );
  }
  if (pollError === "not_found") {
    return (
      <StateCard role="alert" tone="danger" icon={<SearchX />} title="자료를 찾을 수 없습니다" description="삭제되었거나 볼 수 없는 자료입니다. 처리 상태 확인을 멈췄습니다.">
        {action}
      </StateCard>
    );
  }
  if (source.unavailable_at !== null) {
    return (
      <StateCard
        role="status"
        tone="warning"
        icon={<EyeOff />}
        title={isYoutube ? "원본 영상을 더 이상 볼 수 없습니다" : "원본을 더 이상 볼 수 없습니다"}
        description="원본을 더 이상 볼 수 없어 요약과 원문을 숨겼습니다. 자료 정보만 보여 드립니다."
      >
        {action}
      </StateCard>
    );
  }
  if (source.status === "failed") {
    return (
      <StateCard
        role="alert"
        tone="danger"
        icon={<FileX />}
        title="처리하지 못한 자료입니다"
        description={source.error_message ?? "자료를 처리하지 못했습니다. 자료 목록에서 다시 시도해 주세요."}
      >
        {action}
      </StateCard>
    );
  }
  return (
    <StateCard
      role="status"
      icon={<Clock />}
      title="자료를 분석하고 있습니다"
      description="원문을 읽고 요약을 만드는 중입니다. 끝나면 이 화면이 요약 리포트로 바뀝니다. 상태는 자동으로 새로 고칩니다."
    >
      <StatusBadge status={processingStatus(source.status)} />
    </StateCard>
  );
}

function LoginButton({ sourceId }: { sourceId: string }) {
  return (
    <Button asChild size="sm">
      <Link href={`/login?next=${encodeURIComponent(`/sources/${sourceId}`)}`}>로그인</Link>
    </Button>
  );
}
