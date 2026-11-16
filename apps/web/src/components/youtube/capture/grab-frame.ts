// task-030 구현 결정 7: 사용자가 탭 공유를 승인했을 때만 플레이어 영역 한 프레임을 이미지로 만든다.
// getDisplayMedia(현재 탭 우선) → displaySurface가 browser가 아니면 저장 없이 중단 → CropTarget(또는 RestrictionTarget)으로
// 플레이어 영역만 자른다 → video+canvas로 한 프레임 → 트랙 즉시 stop. 승인 거부·취소는 저장 없음.

import { MAX_CAPTURE_BYTES, MAX_CAPTURE_DIMENSION } from "@/lib/storage/images";

/** 데스크톱 구간(DESIGN 토큰 --breakpoint-desk = 75rem) */
export const DESKTOP_QUERY = "(min-width: 75rem)";

interface TargetFactory {
  fromElement(element: Element): Promise<unknown>;
}

type CroppableTrack = MediaStreamTrack & {
  cropTo?: (target: unknown) => Promise<void>;
  restrictTo?: (target: unknown) => Promise<void>;
};

function targetApis() {
  const w = globalThis as unknown as { CropTarget?: TargetFactory; RestrictionTarget?: TargetFactory };
  return { crop: w.CropTarget, restrict: w.RestrictionTarget };
}

/** 진입 조건(결정 8의 화면 쪽): 폭 1200 이상 && getDisplayMedia && CropTarget 또는 RestrictionTarget */
export function captureSupported(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (!window.matchMedia(DESKTOP_QUERY).matches) return false;
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getDisplayMedia !== "function") return false;
  const { crop, restrict } = targetApis();
  return Boolean(crop?.fromElement || restrict?.fromElement);
}

export type GrabResult =
  | { kind: "ok"; blob: Blob; width: number; height: number }
  /** 승인 거부·취소 */
  | { kind: "denied" }
  /** 탭이 아닌 화면·창을 골랐거나 다른 탭이라 자르기 실패 */
  | { kind: "wrong_surface" }
  | { kind: "failed" };

function stopAll(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(() => resolve());
    else if (video.readyState >= 2) resolve();
    else video.addEventListener("loadeddata", () => resolve(), { once: true });
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** WebP를 먼저, 안 되거나 2MB를 넘으면 JPEG 품질을 낮춰 맞춘다 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const attempts: Array<[string, number]> = [
    ["image/webp", 0.85],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.65],
  ];
  for (const [type, quality] of attempts) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_CAPTURE_BYTES) return blob;
  }
  return null;
}

/**
 * 탭 공유 승인을 받아 target 영역의 한 프레임을 이미지로 만든다. 어떤 경우에도 반환 전에 트랙을 멈춘다.
 * signal이 중단되면(화면 이탈) 즉시 트랙을 멈춘다.
 */
export async function grabTabFrame(target: Element, signal?: AbortSignal): Promise<GrabResult> {
  let stream: MediaStream | null = null;
  const onAbort = () => stopAll(stream);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions);
    } catch {
      return { kind: "denied" };
    }
    if (signal?.aborted) return { kind: "denied" };
    const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
    if (!track || track.getSettings().displaySurface !== "browser") return { kind: "wrong_surface" };

    const { crop, restrict } = targetApis();
    try {
      if (crop?.fromElement && track.cropTo) await track.cropTo(await crop.fromElement(target));
      else if (restrict?.fromElement && track.restrictTo) await track.restrictTo(await restrict.fromElement(target));
      else return { kind: "wrong_surface" };
    } catch {
      // 다른 탭을 고르면 자르기가 거부된다
      return { kind: "wrong_surface" };
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await nextFrame(video);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return { kind: "failed" };
    const scale = Math.min(1, MAX_CAPTURE_DIMENSION / vw, MAX_CAPTURE_DIMENSION / vh);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { kind: "failed" };
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 프레임을 얻었으면 인코딩 전에 바로 멈춘다
    stopAll(stream);
    video.srcObject = null;
    const blob = await encode(canvas);
    return blob ? { kind: "ok", blob, width: canvas.width, height: canvas.height } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    stopAll(stream);
    signal?.removeEventListener("abort", onAbort);
  }
}
