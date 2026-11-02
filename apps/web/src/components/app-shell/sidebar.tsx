"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, FileText, FolderOpen, LayoutGrid, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", Icon: LayoutGrid },
  { href: "/projects", label: "프로젝트", Icon: FolderOpen },
  { href: "/reports", label: "리포트", Icon: FileText },
  { href: "/settings", label: "설정", Icon: Settings },
] as const;

export type SidebarUser = { name: string; email: string };
export type SidebarUsage = { used: number; limit: number };

// 데스크톱(1200~)은 전체, 태블릿(768~1199)은 아이콘만. 모바일은 Sheet 안에서 전체로 쓴다.
export function SidebarContent({ user, usage }: { user?: SidebarUser; usage?: SidebarUsage }) {
  const pathname = usePathname();
  const percent = usage && usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-2 flex h-10 items-center gap-2 px-1 md:max-desk:justify-center">
        <span className="grid size-8 place-items-center rounded-row bg-primary text-primary-foreground">
          <BookOpenText aria-hidden className="size-[1.125rem]" />
        </span>
        <span className="font-bold tracking-tight md:max-desk:hidden">KNOWFLOW</span>
      </div>
      <Button asChild className="md:max-desk:mx-auto md:max-desk:w-10 md:max-desk:px-0">
        <Link href="/onboarding" aria-label="새 프로젝트">
          <Plus aria-hidden />
          <span className="md:max-desk:hidden">새 프로젝트</span>
        </Link>
      </Button>
      <nav aria-label="주 메뉴" className="mt-3 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-(--size-touch) items-center gap-3 rounded-row px-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:max-desk:justify-center md:max-desk:px-0",
                active ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon aria-hidden className="size-[1.125rem] shrink-0" />
              <span className="md:max-desk:hidden">{label}</span>
            </Link>
          );
        })}
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
