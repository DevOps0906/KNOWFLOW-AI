import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateCard } from "@/components/states/empty-state";

// S-14: 없는 경로. 권한 없는 리소스도 같은 문구로 존재 여부를 숨긴다.
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <StateCard
        headingLevel={1}
        icon={<Compass />}
        title="찾을 수 없거나 접근 권한이 없습니다"
        description="주소를 확인하거나 처음 화면에서 다시 시작해 주세요."
        className="w-full"
      >
        {/* task-007: 대시보드 생기면 /dashboard로 교체 */}
        <Button asChild>
          <Link href="/">처음으로</Link>
        </Button>
      </StateCard>
    </main>
  );
}
