"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Library, MessageSquare } from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { AddSourceDialog } from "@/components/sources/add-source-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SourceList } from "./source-list";
import { SummaryPanel } from "./summary-panel";
import { isInProgress, type ProjectDetail, type WorkspaceSource } from "./types";
import { useLayoutMode } from "./use-layout-mode";
import { usePolling } from "./use-polling";

// S-08 워크스페이스(DESIGN.md#2). 배치는 CSS 구간(md·desk 토큰)으로 첫 렌더부터 맞춘다.
// 데스크톱 3단(자료 30 : 요약·원문 45 : 채팅 25) / 태블릿 2단(요약·원문 + 채팅, 자료는 옆 시트) /
// 모바일 단일 열(요약·원문) + 채팅 하단 시트, 자료는 같은 옆 시트. JS 구간 판정은 넓어질 때 시트를 닫는 데만 쓴다.
// [projectId]/layout.tsx가 아니라 page.tsx가 이 셸을 렌더한다(sources/new 보호).

const PANEL = "min-h-0 min-w-0 overflow-y-auto rounded-panel border border-border bg-card p-4 shadow-panel";

/** 처리 중이던 자료가 완료·실패로 바뀐 것만 짧게 알린다 */
function finishedMessage(before: WorkspaceSource[], after: WorkspaceSource[]): string {
  const was = new Map(before.map((s) => [s.id, s.status]));
  const parts: string[] = [];
  for (const s of after) {
    const prev = was.get(s.id);
    if (!prev || !isInProgress(prev)) continue;
    if (s.status === "completed") parts.push(`${s.title} 처리 완료`);
    else if (s.status === "failed") parts.push(`${s.title} 처리 실패`);
  }
  return parts.join(", ");
}

const selectable = (s: WorkspaceSource) => s.unavailable_at === null;

export function WorkspaceShell({ initial, youtubeEnabled = false }: { initial: ProjectDetail; youtubeEnabled?: boolean }) {
  const mode = useLayoutMode();
  const [detail, setDetail] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // 서버가 새로 렌더하면(router.refresh, 자료 추가 뒤) 그 값으로 바꾼다
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDetail(initial);
  }

  const { project, sources } = detail;
  const projectId = project.id;
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  });

  const refetch = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("project_detail_failed");
    const next = (await response.json()) as ProjectDetail;
    const message = finishedMessage(sourcesRef.current, next.sources);
    if (message) setAnnouncement(message);
    setDetail(next);
    // 사라졌거나 비활성이 된 자료는 선택에서 뺀다
    const allowed = new Set(next.sources.filter(selectable).map((s) => s.id));
    setSelected((prev) => new Set([...prev].filter((id) => allowed.has(id))));
  }, [projectId]);

  const inProgress = sources.some((s) => isInProgress(s.status));
  const signature = sources.map((s) => `${s.id}:${s.status}:${s.latest_job?.status ?? ""}`).join("|");
  usePolling(inProgress, refetch, signature);

  const addButton = <AddSourceDialog projectId={projectId} youtubeEnabled={youtubeEnabled} />;
  const list = (
    <SourceList
      projectId={projectId}
      sources={sources}
      selected={selected}
      onSelectedChange={setSelected}
      onChanged={() => refetch().catch(() => undefined)}
      addButton={addButton}
    />
  );
  const summary = <SummaryPanel project={project} sources={sources} />;
  const chat = <ChatPanel projectId={projectId} selectedSourceIds={[...selected]} suggestedQuestions={project.suggested_questions} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6 desk:p-4">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="현재 위치" className="text-caption text-muted-foreground">
            <Link href="/projects" className="underline underline-offset-4">
              프로젝트
            </Link>{" "}
            / <span aria-current="page">{project.name}</span>
          </nav>
          <h1 className="mt-1 truncate text-h1 font-bold">{project.name}</h1>
          {inProgress ? <p className="text-caption text-muted-foreground">처리 중인 자료가 있어 상태를 자동으로 새로 고칩니다.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Sheet open={sourcesOpen && mode !== "desktop"} onOpenChange={setSourcesOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="desk:hidden" aria-label={`자료 목록 열기 (${sources.length}개)`}>
                <Library aria-hidden />
                자료 {sources.length}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-(--size-sheet) overflow-y-auto">
              <SheetHeader>
                <SheetTitle>자료</SheetTitle>
                <SheetDescription>질문할 자료를 고르고 처리 상태를 확인합니다.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">{list}</div>
            </SheetContent>
          </Sheet>
          {/* 데스크톱은 빈 목록 안내 안에 자료 추가 버튼이 있다 */}
          <div className={sources.length > 0 ? undefined : "desk:hidden"}>{addButton}</div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-(--grid-workspace-tablet) md:gap-4 desk:grid-cols-(--grid-workspace-desk)">
        <section aria-label="자료" data-testid="sources-column" className="hidden min-h-0 min-w-0 overflow-y-auto pr-1 desk:block">
          {list}
        </section>
        <section aria-label="요약과 원문" className="min-h-0 min-w-0 overflow-y-auto md:rounded-panel md:border md:border-border md:bg-card md:p-4 md:shadow-panel">
          {summary}
        </section>
        <aside aria-label="채팅" data-testid="chat-column" className={`hidden md:block ${PANEL}`}>
          {chat}
        </aside>
      </div>

      <Sheet open={chatOpen && mode === "mobile"} onOpenChange={setChatOpen}>
        <SheetTrigger asChild>
          <Button className="w-full md:hidden">
            <MessageSquare aria-hidden />
            질문하기
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-(--size-sheet-max-h) overflow-y-auto">
          <SheetHeader className="pb-0">
            <SheetTitle className="sr-only">채팅</SheetTitle>
            <SheetDescription className="sr-only">자료에 대해 질문합니다.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{chat}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
