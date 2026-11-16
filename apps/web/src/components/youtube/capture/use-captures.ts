"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MomentItem } from "../embed";
import { captureSupported, grabTabFrame } from "./grab-frame";
import type { CapturesResponse } from "./types";

// 캡처 상태(task-030): 진입 조건(데스크톱·기능 감지) → GET으로 서버 스위치 확인(422 capture_disabled면 숨김)
// → 카드별 캡처(승인 → 미리보기) → 사용자가 확인하면 업로드. 승인 거부·취소·미리보기 취소는 아무것도 저장하지 않는다.

export type CapturesState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ok"; data: CapturesResponse };

export interface CapturePreview {
  moment: MomentItem;
  blob: Blob;
  /** 미리보기마다 새로 만든다(같은 미리보기의 재시도는 같은 키) */
  idempotencyKey: string;
}

export const CAPTURE_TEXT = {
  denied: "탭 공유를 승인하지 않아 캡처하지 않았습니다.",
  wrongSurface: "이 탭을 공유해야 캡처할 수 있습니다. 다시 시도해 주세요.",
  failed: "화면을 캡처하지 못했습니다.",
  uploadFailed: "캡처를 저장하지 못했습니다.",
  deleteFailed: "캡처를 삭제하지 못했습니다.",
} as const;

async function errorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message : fallback;
  } catch {
    return fallback;
  }
}

async function fetchCaptures(sourceId: string): Promise<CapturesState> {
  try {
    const res = await fetch(`/api/sources/${sourceId}/captures`, { cache: "no-store" });
    // 422: 스위치 꺼짐(capture_disabled) 또는 유튜브 외 자료 → 진입을 숨긴다
    if (res.status === 422) return { kind: "off" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as CapturesResponse;
    return data.unavailable ? { kind: "off" } : { kind: "ok", data };
  } catch {
    return { kind: "error" };
  }
}

const newKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useCaptures(sourceId: string, enabled: boolean) {
  // 서버 렌더와 첫 클라이언트 렌더는 항상 off(수화 불일치 방지). 진입 조건은 마운트 뒤에만 판정한다
  const [state, setState] = useState<CapturesState>({ kind: "off" });
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const supportedRef = useRef(false);

  const reload = useCallback(() => {
    if (!supportedRef.current) return;
    setState({ kind: "loading" });
    void fetchCaptures(sourceId).then(setState);
  }, [sourceId]);

  useEffect(() => {
    supportedRef.current = enabled && captureSupported();
    if (!supportedRef.current) return;
    let cancelled = false;
    void fetchCaptures(sourceId).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, enabled]);

  // 화면 이탈 시 진행 중인 탭 공유 트랙을 멈춘다
  useEffect(() => () => abortRef.current?.abort(), []);

  const capture = useCallback(async (moment: MomentItem, target: Element | null) => {
    if (!target) return;
    setMessage(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await grabTabFrame(target, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind === "ok") setPreview({ moment, blob: result.blob, idempotencyKey: newKey() });
      else setMessage(result.kind === "denied" ? CAPTURE_TEXT.denied : result.kind === "wrong_surface" ? CAPTURE_TEXT.wrongSurface : CAPTURE_TEXT.failed);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, []);

  const cancelPreview = useCallback(() => setPreview(null), []);

  const save = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    const t = Math.round(preview.moment.locator.t_start * 1000) / 1000;
    const params = new URLSearchParams({ t: String(t), moment_id: preview.moment.id });
    try {
      const res = await fetch(`/api/sources/${sourceId}/captures?${params.toString()}`, {
        method: "POST",
        body: preview.blob,
        headers: { "Content-Type": preview.blob.type, "Idempotency-Key": preview.idempotencyKey },
      });
      if (!res.ok) {
        setMessage(await errorMessage(res, CAPTURE_TEXT.uploadFailed));
        return;
      }
      setPreview(null);
      reload();
    } catch {
      setMessage(CAPTURE_TEXT.uploadFailed);
    } finally {
      setBusy(false);
    }
  }, [preview, reload, sourceId]);

  const remove = useCallback(
    async (captureId: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/sources/${sourceId}/captures/${captureId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          setMessage(await errorMessage(res, CAPTURE_TEXT.deleteFailed));
          return;
        }
        reload();
      } catch {
        setMessage(CAPTURE_TEXT.deleteFailed);
      } finally {
        setBusy(false);
      }
    },
    [reload, sourceId],
  );

  return { state, preview, busy, message, reload, capture, cancelPreview, save, remove };
}
