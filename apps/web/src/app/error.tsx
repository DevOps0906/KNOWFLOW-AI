"use client";

import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateCard } from "@/components/states/empty-state";

// S-15: 예상 못한 오류. message·stack은 노출하지 않고 digest만 문의용으로 보여 준다.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <StateCard
        headingLevel={1}
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title="문제가 생겼습니다"
        description="잠시 후 다시 시도해 주세요. 계속되면 아래 오류 번호와 함께 문의해 주세요."
        className="w-full"
      >
        {error.digest ? <p className="text-caption text-muted-foreground">오류 번호: {error.digest}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={reset}>
            <RotateCw />
            다시 시도
          </Button>
          {/* task-007: 대시보드 생기면 /dashboard로 교체 */}
          <Link href="/" className="text-caption text-muted-foreground underline underline-offset-4">
            처음으로
          </Link>
        </div>
      </StateCard>
    </main>
  );
}
