"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { captureTabFrame, supportsTabCapture } from "./capture-frame";

/** GET /api/sources/:id/captures 항목(정본: app/api/sources/[sourceId]/captures/handler.ts) */
export interface CaptureListItem {
  id: string;
  moment_id: string | null;
  t_seconds: number;
  url: string;
  created_at: string;
  channel_title: string | null;
  source_url: string | null;
}

export type CaptureListPayload = { enabled: false } | { enabled: true; limit: number; captures: CaptureListItem[] };

export type CaptureStatus =
  | { kind: "idle" }
  | { kind: "busy"; momentId: string }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type ListState = { kind: "loading" } | { kind: "error" } | { kind: "ok"; limit: number; captures: CaptureListItem[] } | { kind: "off" };

const DESKTOP = "(min-width: 75rem)";

export const CAPTURE_STATUS_MESSAGES = {
  denied: "탭 공유를 허용하지 않아 캡처를 저장하지 않았습니다.",
  unsupported: "이 브라우저에서는 화면 캡처를 쓸 수 없습니다.",
  failed: "화면을 캡처하지 못했습니다. 다시 시도해 주세요.",
  tooLarge: "캡처 이미지가 2MB를 넘어 저장하지 않았습니다.",
  limit: "이 영상의 캡처 한도에 도달해 저장하지 않았습니다.",
  saved: "캡처를 저장했습니다.",
} as const;

/** 데스크톱(1200~)이고 탭 공유 API가 있을 때만 true. 서버·모바일·태블릿은 false(진입 숨김) */
export function useDesktopCapture(enabled: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [enabled],
  );
  return useSyncExternalStore(
    subscribe,
    () => enabled && typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches && supportsTabCapture(),
    () => false,
  );
}

async function fetchCaptures(sourceId: string): Promise<ListState> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/captures`, { cache: "no-store" });
    if (res.status === 422) return { kind: "off" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as CaptureListPayload;
    return body.enabled ? { kind: "ok", limit: body.limit, captures: body.captures } : { kind: "off" };
  } catch {
    return { kind: "error" };
  }
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 429) return CAPTURE_STATUS_MESSAGES.limit;
  if (res.status === 413) return CAPTURE_STATUS_MESSAGES.tooLarge;
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // 본문 없음
  }
  return CAPTURE_STATUS_MESSAGES.failed;
}

/** 캡처 목록·저장. enabled가 false면 아무 요청도 하지 않는다 */
export function useCaptures(sourceId: string, enabled: boolean) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [status, setStatus] = useState<CaptureStatus>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchCaptures(sourceId).then((next) => {
      if (!cancelled) setList(next);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, enabled]);

  const reload = useCallback(() => {
    setList({ kind: "loading" });
    void fetchCaptures(sourceId).then(setList);
  }, [sourceId]);

  /** 클릭 핸들러에서 곧바로 부른다: 승인 창 → 한 장 → 업로드. 거부·실패면 저장하지 않는다 */
  const captureMoment = useCallback(
    async (momentId: string, target: HTMLElement | null) => {
      setStatus({ kind: "busy", momentId });
      const frame = await captureTabFrame(target);
      if (!frame.ok) {
        const message =
          frame.reason === "denied"
            ? CAPTURE_STATUS_MESSAGES.denied
            : frame.reason === "unsupported"
              ? CAPTURE_STATUS_MESSAGES.unsupported
              : frame.reason === "too_large"
                ? CAPTURE_STATUS_MESSAGES.tooLarge
                : CAPTURE_STATUS_MESSAGES.failed;
        setStatus({ kind: "error", message });
        return;
      }
      const form = new FormData();
      form.set("moment_id", momentId);
      form.set("image", frame.blob, frame.blob.type === "image/png" ? "capture.png" : "capture.webp");
      try {
        const res = await fetch(`/api/sources/${sourceId}/captures`, { method: "POST", body: form });
        if (!res.ok) {
          setStatus({ kind: "error", message: await errorMessage(res) });
          return;
        }
      } catch {
        setStatus({ kind: "error", message: CAPTURE_STATUS_MESSAGES.failed });
        return;
      }
      setStatus({ kind: "saved" });
      reload();
    },
    [sourceId, reload],
  );

  return { list, status, captureMoment, reload };
}
