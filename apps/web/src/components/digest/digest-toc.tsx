"use client";

import type { TocItem } from "@/components/report/types";
import { cn } from "@/lib/utils";
import type { Digest, DigestMode } from "./types";

const tocNumber = (i: number) => String(i + 1).padStart(2, "0");

const MODES: Array<{ id: DigestMode; label: string }> = [
  { id: "core", label: "핵심" },
  { id: "deep", label: "딥 리서치" },
];

/** 목차 항목: 한눈에 보기 · 핵심 용어(있으면) · 장(딥 리서치만) */
export function digestToc(digest: Digest | null, mode: DigestMode): TocItem[] {
  if (!digest) return [];
  const items: TocItem[] = [{ id: "glance", label: "한눈에 보기" }];
  if (digest.terms.length > 0) items.push({ id: "terms", label: "핵심 용어" });
  if (mode === "deep") digest.chapters.forEach((c, i) => items.push({ id: `chapter-${i}`, label: c.title }));
  return items;
}

// 세그먼트 토글 "핵심 / 딥 리서치"(바탕 세그먼트색, 알약, 선택은 먹색 바탕 흰 글자)
export function ModeToggle({ mode, onChange }: { mode: DigestMode; onChange: (mode: DigestMode) => void }) {
  return (
    <div role="group" aria-label="보기 범위" className="inline-flex self-start rounded-control bg-secondary p-0.5">
      {MODES.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-control px-3 py-1 text-digest-toc font-medium outline-none focus-visible:outline-2 focus-visible:outline-ring",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// 목차: 자료 제목(진하게) + "01 장 제목"(번호 흐린 12px, 항목 회색, 현재 장 진하게)
export function DigestToc({
  title,
  items,
  activeId,
  onSelect,
}: {
  title: string;
  items: TocItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="목차" className="flex min-w-0 flex-col gap-2">
      <p className="text-nav font-semibold break-words text-heading">{title}</p>
      {items.length > 0 ? (
        <ol className="flex flex-col">
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
                    "flex gap-2 rounded-row py-1 text-digest-toc outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span aria-hidden className="shrink-0 text-label text-faint tabular-nums">
                    {tocNumber(i)}
                  </span>
                  <span className="min-w-0 break-words">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      ) : null}
    </nav>
  );
}
