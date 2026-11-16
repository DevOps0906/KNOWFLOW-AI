"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** 이전 화면으로. 바로 들어온 경우(기록 없음)는 랜딩으로 */
export function BackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
    >
      이전으로
    </Button>
  );
}
