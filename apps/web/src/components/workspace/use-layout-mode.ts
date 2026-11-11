"use client";

import { useSyncExternalStore } from "react";

// 반응형 3구간 판정(모바일 ~767 / 태블릿 768~1199 / 데스크톱 1200~). 배치는 CSS가 하고,
// 이 값은 화면이 넓어졌을 때 그 구간에 없는 시트를 닫는 동작에만 쓴다(서버 스냅샷은 데스크톱).
export type LayoutMode = "mobile" | "tablet" | "desktop";

const TABLET = "(min-width: 48rem)";
const DESKTOP = "(min-width: 75rem)";

function subscribe(onChange: () => void) {
  const lists = [window.matchMedia(TABLET), window.matchMedia(DESKTOP)];
  lists.forEach((mq) => mq.addEventListener("change", onChange));
  return () => lists.forEach((mq) => mq.removeEventListener("change", onChange));
}

function snapshot(): LayoutMode {
  if (window.matchMedia(DESKTOP).matches) return "desktop";
  if (window.matchMedia(TABLET).matches) return "tablet";
  return "mobile";
}

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () => "desktop");
}
