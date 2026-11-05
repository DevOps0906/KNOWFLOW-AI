import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { loadProjects } from "@/lib/projects/load";
import { encodeCursor, parseListParams } from "@/lib/projects/params";
import { EmptyProjects, ProjectList } from "./project-list";
import { NewProjectButton } from "./project-dialogs";

export const metadata: Metadata = { title: "프로젝트 · KNOWFLOW-AI" };

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// S-07 프로젝트 목록: 검색·상태·정렬은 GET 폼(주소로 상태 유지), 다음 쪽은 커서 링크.
export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = parseListParams(raw, { lenient: true })!;
  const result = await loadProjects(params);

  const query = (extra: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    next.set("status", params.status);
    next.set("sort", params.sort);
    for (const [k, v] of Object.entries(extra)) next.set(k, v);
    return `/projects?${next.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">프로젝트</h1>
        <NewProjectButton />
      </header>

      <form method="get" role="search" className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-semibold">
          검색
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder="프로젝트 이름"
            className="h-10 w-full rounded-control border border-input bg-background px-3 text-body outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          상태
          <select
            name="status"
            defaultValue={params.status}
            className="h-10 rounded-control border border-input bg-background px-3 text-body"
          >
            <option value="active">진행 중</option>
            <option value="archived">보관됨</option>
            <option value="all">전체</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption font-semibold">
          정렬
          <select
            name="sort"
            defaultValue={params.sort}
            className="h-10 rounded-control border border-input bg-background px-3 text-body"
          >
            <option value="updated">수정일</option>
            <option value="created">만든 날</option>
            <option value="name">이름</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-10">
          적용
        </Button>
      </form>

      {result.state === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorState title="프로젝트를 불러오지 못했습니다" />
          <Button asChild variant="outline" size="sm">
            <Link href={query(params.offset ? { cursor: encodeCursor(params.offset) } : {})}>다시 시도</Link>
          </Button>
        </div>
      ) : result.items.length === 0 ? (
        <EmptyProjects filtered={Boolean(params.q) || params.status !== "active" || params.offset > 0} />
      ) : (
        <>
          <ProjectList items={result.items} />
          <nav aria-label="쪽 이동" className="flex justify-between gap-3">
            {params.offset > 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={query(params.offset > params.limit ? { cursor: encodeCursor(params.offset - params.limit) } : {})}>
                  이전
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {result.hasMore ? (
              <Button asChild variant="outline" size="sm">
                <Link href={query({ cursor: encodeCursor(params.offset + params.limit) })}>다음</Link>
              </Button>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
