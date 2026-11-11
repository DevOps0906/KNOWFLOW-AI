"use client";

import Link from "next/link";
import { Tabs } from "radix-ui";
import { BookOpen } from "lucide-react";
import type { WorkspaceProject, WorkspaceSource } from "./types";

const TAB =
  "h-10 border-b-2 border-transparent px-1 text-body text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-foreground";

/** S-08 ② 요약·원문 탭. 원문 본문은 S-10 뷰어에서 연다(비신뢰 텍스트는 React 이스케이프로만 렌더). */
export function SummaryPanel({ project, sources }: { project: WorkspaceProject; sources: WorkspaceSource[] }) {
  const readable = sources.filter((s) => s.status === "completed" && s.unavailable_at === null);
  const processing = sources.some((s) => s.status === "queued" || s.status === "processing");

  return (
    <Tabs.Root defaultValue="summary" className="flex min-h-0 flex-col gap-4">
      <Tabs.List aria-label="요약과 원문" className="flex gap-4 border-b border-border">
        <Tabs.Trigger value="summary" className={TAB}>
          요약
        </Tabs.Trigger>
        <Tabs.Trigger value="original" className={TAB}>
          원문
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="summary" className="outline-none">
        {project.summary ? (
          <p className="font-serif text-reading leading-reading whitespace-pre-wrap break-keep">{project.summary}</p>
        ) : (
          <p className="text-muted-foreground break-keep">
            {sources.length === 0
              ? "자료를 추가하면 분석이 끝난 뒤 요약이 여기에 나타납니다."
              : processing
                ? "자료를 분석하는 중입니다. 끝나면 요약이 여기에 나타납니다."
                : "아직 요약이 없습니다."}
          </p>
        )}
      </Tabs.Content>

      <Tabs.Content value="original" className="outline-none">
        {readable.length === 0 ? (
          <p className="text-muted-foreground break-keep">처리가 끝난 자료가 생기면 원문을 열어 볼 수 있습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {readable.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sources/${s.id}`}
                  className="flex min-w-0 items-center gap-2 rounded-row p-2 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <BookOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tabs.Content>
    </Tabs.Root>
  );
}
