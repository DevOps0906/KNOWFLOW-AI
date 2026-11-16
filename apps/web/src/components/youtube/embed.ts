// 공식 임베드(youtube-nocookie.com) 주소. IFrame API 스크립트·postMessage는 쓰지 않고 iframe src 교체로 시각을 옮긴다.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(videoId: string | null | undefined): videoId is string {
  return typeof videoId === "string" && VIDEO_ID.test(videoId);
}

/** video_id가 11자 형식이 아니면 null(플레이어를 그리지 않는다). autoplay는 사용자가 시각을 고른 뒤에만 켠다. */
export function embedSrc(videoId: string | null | undefined, startSeconds: number | null, autoplay: boolean): string | null {
  if (!isValidVideoId(videoId)) return null;
  const base = `https://www.youtube-nocookie.com/embed/${videoId}`;
  if (startSeconds === null || !Number.isFinite(startSeconds)) return autoplay ? `${base}?autoplay=1` : base;
  const start = Math.max(0, Math.floor(startSeconds));
  return `${base}?start=${start}${autoplay ? "&autoplay=1" : ""}`;
}
