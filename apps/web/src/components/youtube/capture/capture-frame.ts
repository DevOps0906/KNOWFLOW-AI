// L1 탭 캡처(task-030): 사용자가 브라우저 탭 공유를 승인했을 때만 그 순간 화면 한 장을 만든다.
// 서버는 영상을 받지 않는다. 승인 거부·미지원이면 아무것도 만들지 않는다. 스트림은 한 장을 얻으면 바로 끈다.

/** 서버 상한과 같은 값(lib/storage/captures.ts CAPTURE_MAX_BYTES) */
export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;

export type FrameResult = { ok: true; blob: Blob } | { ok: false; reason: "unsupported" | "denied" | "failed" | "too_large" };

type DisplayMediaFn = (options?: DisplayMediaStreamOptions) => Promise<MediaStream>;

/** 탭 공유 API가 있는 브라우저인가(데스크톱 Chrome·Edge·Firefox·Safari) */
export function supportsTabCapture(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** 사용자 승인 창을 띄운다. 거부·취소는 denied, 미지원은 unsupported */
export async function requestTabStream(): Promise<{ ok: true; stream: MediaStream } | { ok: false; reason: "unsupported" | "denied" | "failed" }> {
  if (!supportsTabCapture()) return { ok: false, reason: "unsupported" };
  const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) as DisplayMediaFn;
  try {
    // 현재 탭을 먼저 제안한다(지원 브라우저만 쓰는 비표준 옵션 포함). 오디오는 받지 않는다
    const options = { video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" };
    return { ok: true, stream: await getDisplayMedia(options as DisplayMediaStreamOptions) };
  } catch (error) {
    const name = error instanceof DOMException || error instanceof Error ? error.name : "";
    return { ok: false, reason: name === "NotAllowedError" || name === "AbortError" ? "denied" : "failed" };
  }
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * 캡처한 화면이 이 탭(뷰포트와 같은 비율)이면 플레이어 영역만 잘라낸다. 다른 탭·창이면 전체를 쓴다.
 * 반환은 원본 프레임 좌표의 사각형.
 */
export function cropRect(
  frame: { width: number; height: number },
  viewport: { width: number; height: number },
  target: { left: number; top: number; width: number; height: number } | null,
) {
  const full = { x: 0, y: 0, width: frame.width, height: frame.height };
  if (!target || viewport.width <= 0 || viewport.height <= 0 || frame.width <= 0 || frame.height <= 0) return full;
  const sameRatio = Math.abs(frame.width / frame.height - viewport.width / viewport.height) < 0.02;
  if (!sameRatio) return full;
  const scale = frame.width / viewport.width;
  const x = Math.max(0, Math.round(target.left * scale));
  const y = Math.max(0, Math.round(target.top * scale));
  const width = Math.min(frame.width - x, Math.round(target.width * scale));
  const height = Math.min(frame.height - y, Math.round(target.height * scale));
  return width > 0 && height > 0 ? { x, y, width, height } : full;
}

/** 스트림에서 한 장을 그려 WebP(안 되면 PNG)로 만든다. 상한을 넘으면 품질·크기를 낮춰 다시 시도한다 */
async function grabFrame(stream: MediaStream, target: HTMLElement | null): Promise<FrameResult> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  // 첫 프레임이 디코딩될 때까지 기다린다
  if (video.readyState < 2) await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));

  const frame = { width: video.videoWidth, height: video.videoHeight };
  const rect = cropRect(
    frame,
    { width: window.innerWidth, height: window.innerHeight },
    target ? target.getBoundingClientRect() : null,
  );
  for (const scale of [1, 0.75, 0.5]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "failed" };
    ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const webp = await toBlob(canvas, "image/webp", 0.85);
    // WebP 인코딩을 지원하지 않는 브라우저는 PNG를 돌려준다
    const blob = webp && (webp.type === "image/webp" || webp.type === "image/png") ? webp : await toBlob(canvas, "image/png");
    if (blob && blob.size <= CAPTURE_MAX_BYTES) return { ok: true, blob };
  }
  return { ok: false, reason: "too_large" };
}

/** 사용자 승인 → 한 장 캡처 → 스트림 종료. 클릭 핸들러 안에서 바로 불러야 한다(사용자 활성화 필요) */
export async function captureTabFrame(target: HTMLElement | null): Promise<FrameResult> {
  const requested = await requestTabStream();
  if (!requested.ok) return requested;
  try {
    return await grabFrame(requested.stream, target);
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    stopStream(requested.stream);
  }
}
