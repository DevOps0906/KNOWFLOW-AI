"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent, type SidebarUsage, type SidebarUser } from "./sidebar";

// 전역 상단바 없음: 모바일에서만 햄버거가 있는 얇은 줄이 나온다. 사이드바에는 그림자를 쓰지 않는다.
export function AppShell({
  children,
  user,
  usage,
}: {
  children: React.ReactNode;
  user?: SidebarUser;
  usage?: SidebarUsage;
}) {
  const [open, setOpen] = useState(false);

  // 태블릿 이상으로 넓어지면 모바일 시트를 닫는다(고정 사이드바가 대신 보인다).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 48rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <div className="flex h-dvh">
      <aside
        aria-label="사이드바"
        className="hidden shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:block md:w-16 desk:w-60"
      >
        <SidebarContent user={user} usage={usage} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="메뉴 열기">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-[min(20rem,88vw)] bg-sidebar p-0 text-sidebar-foreground"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              <SheetTitle className="sr-only">메뉴</SheetTitle>
              <SheetDescription className="sr-only">주 메뉴와 계정</SheetDescription>
              <SidebarContent user={user} usage={usage} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold">KNOWFLOW</span>
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
