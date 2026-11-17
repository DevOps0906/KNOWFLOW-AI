import { redirect } from "next/navigation";

// 이전 경로(DESIGN.md §2-1): 프로젝트 = 폴더. 워크스페이스 대신 그 폴더의 자료 라이브러리로 보낸다.
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/sources?folder=${encodeURIComponent(projectId)}`);
}
