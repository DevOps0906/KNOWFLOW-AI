import { redirect } from "next/navigation";

// 이전 경로: 자료 추가는 폴더 보기의 "가져오기" 다이얼로그로 옮겼다.
export default async function NewSourcePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/sources?folder=${encodeURIComponent(projectId)}`);
}
