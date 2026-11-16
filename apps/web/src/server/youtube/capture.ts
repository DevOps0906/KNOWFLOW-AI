import "server-only";
import { isYoutubeEnabled } from "./service";

// L1 캡처 플래그(task-030). 유튜브 플래그와 별도이고 기본 꺼짐. task-026(프레임 저장 허용) 판정 뒤에만 켠다.
// 유튜브 기능이 꺼져 있으면 캡처도 꺼진 것으로 본다.
export function readCaptureFlag(env: Record<string, string | undefined>): boolean {
  return env.YOUTUBE_CAPTURE_ENABLED === "true";
}

export function isCaptureEnabled(): boolean {
  return readCaptureFlag(process.env) && isYoutubeEnabled();
}
