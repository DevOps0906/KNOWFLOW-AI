import { redirect } from "next/navigation";

// 이전 경로(DESIGN.md §2-1): 대시보드는 자료 라이브러리로 합쳐졌다.
export default function DashboardPage() {
  redirect("/sources");
}
