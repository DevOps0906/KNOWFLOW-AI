import "server-only";

// A-04 유튜브 URL 검증(task-027b). 서버는 이 URL을 fetch하지 않고 video_id만 뽑는다.
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = ["shorts", "embed", "live"] as const;

/** 허용된 형태의 영상 1건 URL이면 11자 video_id, 아니면 null. `list` 등 다른 파라미터는 무시한다. */
export function parseYoutubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 2048) return null;
  // 기본 포트(:443·:80)는 WHATWG 파싱에서 지워지므로 원문 authority에서 포트·userinfo를 먼저 거부한다
  const authority = /^https?:\/\/([^/?#]*)/i.exec(raw)?.[1];
  if (authority === undefined || authority.includes(":") || authority.includes("@")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined;
  if (host === "youtu.be") {
    candidate = segments.length === 1 ? segments[0] : null;
  } else if (segments.length === 1 && segments[0] === "watch") {
    const values = url.searchParams.getAll("v");
    candidate = values.length === 1 ? values[0] : null;
  } else if (segments.length === 2 && (PATH_PREFIXES as readonly string[]).includes(segments[0]!)) {
    candidate = segments[1];
  } else {
    // /redirect·/playlist·/channel·/@핸들 등은 모두 거부
    return null;
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** original_url·Gemini 입력에 쓰는 정규 URL. */
export function canonicalYoutubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
