import { redirect } from "next/navigation";

// 이전 경로(DESIGN.md §2-1): 프로젝트 목록은 자료 라이브러리(폴더 카드)로 바뀌었다.
export default function ProjectsPage() {
  redirect("/sources");
}
