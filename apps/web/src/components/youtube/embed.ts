// 유튜브 임베드·장면 카드 표시용 순수 함수와 A-07 /moments 응답 형태(task-029b).
// 플레이어는 youtube-nocookie iframe src 교체로만 시각을 옮긴다(IFrame API 스크립트·postMessage 없음).

/** DB CHECK와 같은 11자 규칙. 렌더 때 다시 확인한다 */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(videoId: string | null | undefined): videoId is string {
  return typeof videoId === "string" && VIDEO_ID_PATTERN.test(videoId);
}

/** 임베드 주소. 형식이 틀린 video_id면 null(iframe을 그리지 않는다) */
export function embedSrc(videoId: string | null | undefined, startSeconds: number | null, autoplay: boolean): string | null {
  if (!isValidVideoId(videoId)) return null;
  const params = new URLSearchParams();
  if (startSeconds !== null && Number.isFinite(startSeconds) && startSeconds > 0) params.set("start", String(Math.floor(startSeconds)));
  if (autoplay) params.set("autoplay", "1");
  const query = params.toString();
  return `https://www.youtube-nocookie.com/embed/${videoId}${query ? `?${query}` : ""}`;
}

// 양방향 제어(U+202A~202E, U+2066~2069, U+200E·200F, U+061C)와 zero-width(U+200B~200D, U+2060, U+FEFF) 문자
const INVISIBLE = /[؜​-‏‪-‮⁠⁦-⁩﻿]/g;

/** 비신뢰 텍스트(요약·장면 제목/설명): 보이지 않는 제어 문자를 지운다. 렌더는 React 텍스트로만 한다 */
export function cleanText(text: string): string {
  return text.replace(INVISIBLE, "");
}

/** GET /api/sources/:id/moments 장면 카드 */
export interface MomentItem {
  id: string;
  moment_index: number;
  locator: { t_start: number; t_end: number };
  title: string;
  description: string;
  /** 겹치는 전사 청크가 있어 리포트에 인용할 수 있는지 */
  citable: boolean;
}

export interface SummarySentence {
  text: string;
  /** 지금 그 자료에 있는 청크만(재처리로 사라진 청크는 뺀다). t_start는 그 청크의 시작 시각 */
  citations: Array<{ chunk_id: string; t_start: number | null }>;
}

/** GET /api/sources/:id/moments 응답. 플래그가 꺼지면 {enabled:false}만 */
export type MomentsResponse =
  | { enabled: false }
  | { enabled: true; unavailable: boolean; items: MomentItem[]; summary: { sentences: SummarySentence[] } | null };
