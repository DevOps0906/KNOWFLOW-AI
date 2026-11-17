"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Pin, PinOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 입력 중에는 단축키를 무시한다 */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** O 키로 원문 카드를 연다·닫는다(enabled일 때만, 입력 중·조합키 제외) */
export function useOriginalShortcut(enabled: boolean, toggle: () => void) {
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

// 원문 카드(Readray ③ 원문 뷰어): 큰 반경·그림자의 떠 있는 카드. 머리줄 "원문 [O]" + 고정·닫기.
// pinned면 3단 그리드의 왼쪽 열로 들어가고(데스크톱만), 아니면 화면 위에 떠 있다. Esc로 닫는다.
export function OriginalCard({
  pinned,
  onTogglePin,
  onClose,
  children,
}: {
  pinned: boolean;
  /** 없으면 고정 버튼을 숨긴다(고정 열이 없는 화면) */
  onTogglePin?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 열릴 때 초점을 카드 머리로 옮긴다(고정 전환 때는 옮기지 않는다)
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby="original-card-title"
      data-testid="original-card"
      data-pinned={pinned || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-card shadow-panel",
        pinned
          ? "h-full"
          : "fixed inset-3 z-40 md:inset-y-6 md:right-6 md:left-auto md:w-(--container-reading) md:max-w-[calc(100vw-3rem)] desk:right-auto desk:left-6",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 id="original-card-title" ref={headingRef} tabIndex={-1} className="flex items-center gap-2 font-semibold outline-none">
          원문
          <kbd aria-label="단축키 O" className="rounded-sm border border-border px-1.5 text-caption font-normal text-muted-foreground">
            O
          </kbd>
        </h2>
        <div className="flex items-center gap-1">
          {onTogglePin ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden desk:inline-flex"
            aria-pressed={pinned}
            aria-label={pinned ? "원문 고정 풀기" : "원문을 왼쪽에 고정"}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="원문 닫기" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">{children}</div>
    </section>
  );
}
