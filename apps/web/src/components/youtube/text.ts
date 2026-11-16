// 유튜브 화면 공용 변환(task-029 구현 결정 4·6). 요약·장면 제목/설명은 비신뢰 텍스트다: React 텍스트로만 렌더한다.

/** video_id 11자. 저장값이어도 렌더 때 다시 확인한다 */
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Bidi_Control 전체(U+061C, U+200E·200F, U+202A~202E, U+2066~2069)·zero-width(U+200B~200D, U+2060, U+FEFF) 문자
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** 비신뢰 텍스트에서 보이지 않는 제어 문자를 지운다 */
export function cleanUntrustedText(text: string): string {
  return text.replace(INVISIBLE, "");
}

/**
 * 공식 임베드 주소(youtube-nocookie). 시각 이동은 iframe src 교체로만 한다(IFrame API·postMessage 없음).
 * video_id가 형식에 맞지 않으면 null(호출부가 원본 링크로 대체).
 */
export function embedUrl(videoId: string | null, startSeconds: number | null, autoplay: boolean): string | null {
  if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;
  const params = new URLSearchParams();
  const start = startSeconds !== null && Number.isFinite(startSeconds) ? Math.max(0, Math.floor(startSeconds)) : 0;
  if (start > 0) params.set("start", String(start));
  if (autoplay) params.set("autoplay", "1");
  const query = params.toString();
  return `https://www.youtube-nocookie.com/embed/${videoId}${query ? `?${query}` : ""}`;
}
