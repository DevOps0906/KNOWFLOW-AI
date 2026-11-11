import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { loadProjects } from "@/lib/projects/load";
import { serverSupabaseOrNull } from "@/lib/projects/server";
import { listProcessingSources, type ProcessingSourceItem } from "@/lib/sources/processing";
import { EmptyProjects, ProjectList } from "../projects/project-list";
import { NewProjectButton } from "../projects/project-dialogs";
import { ProcessingSources } from "./processing-sources";

export const metadata: Metadata = { title: "대시보드 · KNOWFLOW-AI" };

export const dynamic = "force-dynamic";

const RECENT = { q: "", status: "active", sort: "updated", limit: 5, offset: 0 } as const;

async function loadProcessing(): Promise<ProcessingSourceItem[] | null> {
  try {
    const supabase = await serverSupabaseOrNull();
    return supabase ? await listProcessingSources(supabase) : null;
  } catch {
    return null;
  }
}

// S-06 대시보드: 만들던 프로젝트 이어가기 + 처리 중 자료(RLS 한 번 조회).
export default async function DashboardPage() {
  const result = await loadProjects(RECENT);
  const processing = await loadProcessing();
  return (
    <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">대시보드</h1>
        <NewProjectButton />
      </header>

      <section aria-labelledby="recent-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-title" className="text-h2 font-semibold">
            최근 프로젝트
          </h2>
          <Button asChild variant="link" size="sm">
            <Link href="/projects">전체 보기</Link>
          </Button>
        </div>
        {result.state === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <ErrorState title="프로젝트를 불러오지 못했습니다" />
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">다시 시도</Link>
            </Button>
          </div>
        ) : result.items.length === 0 ? (
          <EmptyProjects />
        ) : (
          <ProjectList items={result.items} withActions={false} />
        )}
      </section>

      <section aria-labelledby="processing-title" className="flex flex-col gap-3">
        <h2 id="processing-title" className="text-h2 font-semibold">
          처리 중 자료
        </h2>
        {processing === null ? (
          <div className="flex flex-col items-start gap-3">
            <ErrorState title="처리 중 자료를 불러오지 못했습니다" />
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">다시 시도</Link>
            </Button>
          </div>
        ) : (
          <ProcessingSources items={processing} />
        )}
      </section>
    </div>
  );
}
