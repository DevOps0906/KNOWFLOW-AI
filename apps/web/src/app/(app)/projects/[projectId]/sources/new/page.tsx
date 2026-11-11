import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddSourceForm } from "@/components/sources/add-source-form";
import { serverSupabaseOrNull } from "@/lib/projects/server";
import { isYoutubeEnabled } from "@/server/youtube/service";

export const metadata: Metadata = { title: "자료 추가 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// S-09 단독 진입 화면. S-08 워크스페이스(task-012)가 생기면 같은 폼을 모달(AddSourceDialog)로 연다.
export default async function NewSourcePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UUID.test(projectId)) notFound();
  const supabase = await serverSupabaseOrNull();
  if (!supabase) notFound();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  // RLS: 타인·삭제된 프로젝트는 보이지 않으므로 존재 여부가 드러나지 않는다
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).is("deleted_at", null).maybeSingle();
  if (!project) notFound();

  return (
    <div className="mx-auto flex max-w-xl min-w-0 flex-col gap-6 p-4 md:p-6">
      <header>
        <p className="text-caption text-muted-foreground">
          <Link href="/projects" className="underline underline-offset-4">
            프로젝트
          </Link>{" "}
          / {project.name}
        </p>
        <h1 className="mt-1 text-h1 font-bold">자료 추가</h1>
      </header>
      <section className="rounded-panel border border-border bg-card p-4 md:p-6">
        <AddSourceForm projectId={project.id} youtubeEnabled={isYoutubeEnabled()} />
      </section>
    </div>
  );
}
