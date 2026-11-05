import Link from "next/link";
import { FolderPlus } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import type { ProjectItem } from "@/lib/projects/types";
import { NewProjectButton, ProjectRowActions } from "./project-dialogs";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

export function EmptyProjects({ filtered = false }: { filtered?: boolean }) {
  return filtered ? (
    <EmptyState icon={<FolderPlus />} title="조건에 맞는 프로젝트가 없습니다" description="검색어나 상태 조건을 바꿔 보세요." />
  ) : (
    <EmptyState
      icon={<FolderPlus />}
      title="아직 프로젝트가 없습니다"
      description="새 프로젝트를 만들고 PDF나 웹 페이지를 모아 보세요."
    >
      <NewProjectButton />
    </EmptyState>
  );
}

/** 프로젝트 행 목록. 모바일은 카드, 768 이상은 표처럼 열을 맞춘다. 상세(S-08) 링크는 task-012에서 화면이 생긴다. */
export function ProjectList({ items, withActions = true }: { items: ProjectItem[]; withActions?: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-panel border border-border bg-card">
      {items.map((project) => (
        <li
          key={project.id}
          className="grid min-w-0 gap-2 p-4 md:grid-cols-[minmax(0,1fr)_6rem_8rem_6rem_auto] md:items-center md:gap-4"
        >
          <div className="min-w-0">
            <Link
              href={`/projects/${project.id}`}
              className="block truncate font-semibold outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {project.name}
            </Link>
            {project.description ? (
              <p className="truncate text-caption text-muted-foreground">{project.description}</p>
            ) : null}
          </div>
          <span className="text-caption text-muted-foreground">자료 {project.sourceCount}개</span>
          <time dateTime={project.updatedAt} className="text-caption text-muted-foreground">
            {dateFormat.format(new Date(project.updatedAt))}
          </time>
          <span>
            <Badge variant={project.status === "archived" ? "wait" : "ok"}>
              {project.status === "archived" ? "보관됨" : "진행 중"}
            </Badge>
          </span>
          {withActions ? <ProjectRowActions project={project} /> : <span />}
        </li>
      ))}
    </ul>
  );
}
