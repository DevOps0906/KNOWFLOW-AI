"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, FileText, Folder, Library, MessagesSquare, Plus, Search } from "lucide-react";
import { importHref } from "@/components/import/import-href";
import { NewFolderButton } from "@/components/library/folder-dialogs";
import { Progress } from "@/components/ui/progress";
import type { FolderOption } from "@/lib/projects/folders";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

export type SidebarUser = { name: string; email: string };
export type SidebarUsage = { used: number; limit: number };

const ROW =
  "flex min-h-(--size-touch) items-center gap-3 rounded-row px-3 text-nav font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:max-desk:justify-center md:max-desk:px-0";

function NavLink({ href, label, Icon, active }: { href: string; label: string; Icon: typeof Library; active: boolean }) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(ROW, "flex-1", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60")}
    >
      <Icon aria-hidden className="size-[1.125rem] shrink-0" />
      <span className="md:max-desk:hidden">{label}</span>
    </Link>
  );
}

// Lilys 구조(DESIGN.md §2-1·§2-2): 로고·검색 → + 자료 가져오기(/new/source 화면) → 자료(하위 폴더 + 폴더 추가) → 채팅(준비 중) → 작업물 · 하단 사용량·계정.
// 데스크톱(1200~)은 전체, 태블릿(768~1199)은 아이콘만(폴더 목록 숨김). 모바일은 Sheet 안에서 전체로 쓴다.
export function SidebarContent({
  user,
  usage,
  folders = [],
  youtubeEnabled = false,
}: {
  user?: SidebarUser;
  usage?: SidebarUsage;
  folders?: FolderOption[];
  youtubeEnabled?: boolean;
}) {
  const pathname = usePathname();
  const percent = usage && usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  const within = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className="mb-2 flex h-10 items-center gap-2 px-1 md:max-desk:justify-center">
        <span className="grid size-8 place-items-center rounded-row bg-primary text-primary-foreground">
          <BookOpenText aria-hidden className="size-[1.125rem]" />
        </span>
        <span className="flex-1 font-bold tracking-tight md:max-desk:hidden">KNOWFLOW</span>
        <Link
          href="/sources#library-search"
          aria-label="자료 검색"
          title="자료 검색"
          className="grid size-8 place-items-center rounded-row text-muted-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:max-desk:hidden"
        >
          <Search aria-hidden className="size-[1.125rem]" />
        </Link>
      </div>
      <div className="flex"><NavLink href={importHref(youtubeEnabled)} label="자료 가져오기" Icon={Plus} active={within("/new/source")} /></div>
      <nav aria-label="주 메뉴" className="mt-3 flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <NavLink href="/sources" label="자료" Icon={Library} active={within("/sources")} />
          <span className="md:max-desk:hidden">
            <NewFolderButton compact />
          </span>
        </div>
        {folders.length > 0 ? (
          <ul aria-label="폴더" className="ml-6 flex flex-col gap-0.5 border-l border-border pl-2 md:max-desk:hidden">
            {folders.map((folder) => (
              <li key={folder.id}>
                <Link
                  href={`/sources?folder=${folder.id}`}
                  className="flex min-h-9 items-center gap-2 rounded-row px-2 text-caption text-muted-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Folder aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <span aria-disabled="true" title="채팅 (준비 중)" className={cn(ROW, "cursor-not-allowed text-muted-foreground opacity-60")}>
          <MessagesSquare aria-hidden className="size-[1.125rem] shrink-0" />
          <span className="md:max-desk:hidden">채팅</span>
          <span className="ml-auto text-caption md:max-desk:hidden">준비 중</span>
        </span>
        <div className="flex"><NavLink href="/reports" label="작업물" Icon={FileText} active={within("/reports")} /></div>
      </nav>
      {usage ? (
        <div className="mt-auto rounded-row bg-muted px-3 py-3 md:max-desk:hidden">
          <div className="flex justify-between text-caption">
            <span>이번 달 사용량</span>
            <span className="font-semibold tabular-nums">{percent}%</span>
          </div>
          <Progress value={percent} aria-label="이번 달 사용량" className="mt-2 h-1.5" />
          <p className="mt-2 text-caption tabular-nums text-muted-foreground">
            질문 {usage.used} / {usage.limit}회
          </p>
        </div>
      ) : null}
      <div
        className={cn(
          "mt-3 flex items-center gap-2 border-t border-border px-1 pt-3 md:max-desk:flex-col md:max-desk:justify-center",
          usage ? "" : "mt-auto"
        )}
      >
        {user ? (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-caption font-semibold">
              {user.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 md:max-desk:hidden">
              <p className="truncate font-medium">{user.name}</p>
              <p className="truncate text-caption text-muted-foreground">{user.email}</p>
            </div>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}
