import { callProjects, type ProjectCallResult } from "./client";

// S-06 "자료부터 넣기": 프로젝트 없이 자료를 올리면 자료 이름으로 프로젝트를 자동으로 만든다.
// 흐름: 프로젝트 생성 → 자료 등록 → (유튜브) 영상 제목으로 이름 확정. 등록이 실패하면 빈 프로젝트를 소프트 삭제한다.
export const PROJECT_NAME_MAX = 100; // handlers.ts validName과 같은 규칙(코드 포인트 100자)

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** 프로젝트 이름 제약 안으로 자른다(코드 포인트 기준, 공백 정리). 빈 문자열이면 fallback. */
export function clampProjectName(raw: string, fallback = "새 프로젝트"): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const clipped = Array.from(cleaned).slice(0, PROJECT_NAME_MAX).join("").trim();
  return clipped || fallback;
}

/** PDF 파일명에서 확장자를 뺀 이름. */
export function projectNameFromPdf(fileName: string): string {
  return clampProjectName(fileName.replace(/\.pdf$/i, ""), "새 프로젝트");
}

/** 브라우저용 가벼운 video_id 추출(정식 검증은 서버가 한다). 모르는 형태는 null. */
export function youtubeVideoIdFromUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | undefined;
  if (host === "youtu.be") candidate = segments[0];
  else if (segments[0] === "watch") candidate = url.searchParams.get("v") ?? undefined;
  else if (["shorts", "embed", "live"].includes(segments[0] ?? "")) candidate = segments[1];
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export function projectNameFromYoutubeId(videoId: string): string {
  return clampProjectName(`유튜브 영상 ${videoId}`);
}

type Call = typeof callProjects;

/** 새 프로젝트를 만든다. 성공하면 id. */
export async function createProjectNamed(name: string, call: Call = callProjects): Promise<ProjectCallResult> {
  return call("POST", "/api/projects", { name: clampProjectName(name) });
}

/** 자료 등록이 실패했을 때 빈 프로젝트를 남기지 않는다(소프트 삭제, 실패해도 조용히 넘어간다). */
export async function discardProject(projectId: string, call: Call = callProjects): Promise<boolean> {
  const result = await call("DELETE", `/api/projects/${projectId}`);
  return result.ok;
}

/** 프로젝트의 자료 수. 확인할 수 없으면 null(응답이 유실됐을 수 있으니 이때는 지우지 않는다). */
export async function countProjectSources(projectId: string, doFetch: typeof fetch = fetch): Promise<number | null> {
  try {
    const response = await doFetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { sources?: unknown } | null;
    return Array.isArray(data?.sources) ? data.sources.length : null;
  } catch {
    return null;
  }
}

export type CleanupOutcome = "removed" | "has_sources" | "unknown" | "remains";

/** 등록 실패 뒤 정리: 자료 0건이 확인될 때만 삭제한다. */
export async function cleanupAfterFailure(
  projectId: string,
  deps: { fetch?: typeof fetch; call?: Call } = {},
): Promise<CleanupOutcome> {
  const count = await countProjectSources(projectId, deps.fetch);
  if (count === null) return "unknown";
  if (count > 0) return "has_sources";
  return (await discardProject(projectId, deps.call)) ? "removed" : "remains";
}

/** 정리 결과가 "프로젝트를 남겼다"일 때 화면에 보일 안내. removed면 null. */
export function leftoverMessage(outcome: CleanupOutcome): string | null {
  if (outcome === "removed") return null;
  if (outcome === "remains") return "빈 프로젝트가 남았습니다. 프로젝트 화면에서 삭제할 수 있습니다.";
  if (outcome === "has_sources") return "일부 자료가 이미 등록되어 프로젝트를 남겼습니다.";
  return "프로젝트가 만들어졌지만 자료 등록을 확인하지 못했습니다.";
}

/** 첫 자료의 제목(영상 제목)으로 프로젝트 이름을 바꾼다. 실패해도 임시 이름이 남을 뿐이다. */
export async function renameFromFirstSource(
  projectId: string,
  deps: { fetch?: typeof fetch; call?: Call } = {},
): Promise<string | null> {
  const doFetch = deps.fetch ?? fetch;
  const call = deps.call ?? callProjects;
  try {
    const response = await doFetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as { sources?: Array<{ title?: unknown }> } | null;
    const title = data?.sources?.[0]?.title;
    if (typeof title !== "string" || title.trim().length === 0) return null;
    const name = clampProjectName(title, "");
    if (!name) return null;
    const result = await call("PATCH", `/api/projects/${projectId}`, { name });
    return result.ok ? name : null;
  } catch {
    return null;
  }
}
