"use client";

import { cn } from "@/lib/utils";
import type { TocItem } from "./types";

export const tocNumber = (i: number) => String(i + 1).padStart(2, "0");

// 번호 목차(Readray ③): 맨 위 자료 제목, 아래 "01 제목". 현재 장은 진한 번호 배지 + 진한 글씨.
// variant="inline"은 태블릿·모바일(또는 원문 고정 시) 리포트 위 가로 줄.
export function ReportToc({
  title,
  items,
  activeId,
  onSelect,
  variant = "aside",
}: {
  title: string;
  items: TocItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  variant?: "aside" | "inline";
}) {
  const inline = variant === "inline";
  return (
    <nav aria-label={inline ? "목차(가로)" : "목차"} className="flex min-w-0 flex-col gap-3">
      {inline ? null : <p className="text-body font-bold break-words">{title}</p>}
      <ol className={cn("flex gap-1", inline ? "flex-wrap" : "flex-col")}>
        {items.map((item, i) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(item.id);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-row px-2 py-1.5 text-caption outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid min-w-6 place-items-center rounded-sm px-1 tabular-nums",
                    active ? "bg-foreground text-background" : "text-muted-foreground",
                  )}
                >
                  {tocNumber(i)}
                </span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
