import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/projects/queries";

// 자료 라이브러리(/sources): 모든 폴더(projects)의 자료를 RLS로 한 번에 읽는다. 폴더 보기는 ?folder=<id>.
// RLS가 본인·삭제되지 않은 폴더·자료만 보여 준다. deleted_at 조건은 같은 뜻을 한 번 더 적은 것이다.

export const LIBRARY_LIMIT = 100;
export const LIBRARY_STATUSES = ["all", "processing", "completed", "failed"] as const;
export const LIBRARY_TYPES = ["all", "pdf", "youtube", "url"] as const;
export const LIBRARY_SORTS = ["new", "old", "name"] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibraryParams {
  folder: string | null;
  q: string;
  status: LibraryStatus;
  type: LibraryType;
  sort: LibrarySort;
}

export interface LibrarySourceItem {
  id: string;
  folderId: string;
  folderName: string;
  title: string;
  sourceType: string;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;

function pick(raw: Raw, key: string): string | undefined {
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined, fallback: T): T {
  return value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** 화면 주소 파라미터. 모르는 값은 기본값으로 바꾼다(화면은 오류 대신 전체 목록). */
export function parseLibraryParams(raw: Raw): LibraryParams {
  const folder = pick(raw, "folder");
  return {
    folder: folder && UUID.test(folder) ? folder.toLowerCase() : null,
    q: (pick(raw, "q") ?? "").trim().slice(0, 100),
    status: oneOf(LIBRARY_STATUSES, pick(raw, "status"), "all"),
    type: oneOf(LIBRARY_TYPES, pick(raw, "type"), "all"),
    sort: oneOf(LIBRARY_SORTS, pick(raw, "sort"), "new"),
  };
}

/** 기본값이 아닌 파라미터만 남긴 주소. */
export function libraryHref(params: Partial<LibraryParams>): string {
  const next = new URLSearchParams();
  if (params.folder) next.set("folder", params.folder);
  if (params.q) next.set("q", params.q);
  if (params.status && params.status !== "all") next.set("status", params.status);
  if (params.type && params.type !== "all") next.set("type", params.type);
  if (params.sort && params.sort !== "new") next.set("sort", params.sort);
  const qs = next.toString();
  return qs ? `/sources?${qs}` : "/sources";
}

interface Row {
  id: string;
  project_id: string;
  title: string;
  source_type: string;
  status: LibrarySourceItem["status"];
  created_at: string;
  projects: { name: string } | Array<{ name: string }> | null;
}

export async function listLibrarySources(supabase: SupabaseClient, params: LibraryParams): Promise<LibrarySourceItem[]> {
  let query = supabase
    .from("sources")
    .select("id, project_id, title, source_type, status, created_at, projects(name)")
    .is("deleted_at", null);
  if (params.folder) query = query.eq("project_id", params.folder);
  if (params.status === "processing") query = query.in("status", ["queued", "processing"]);
  else if (params.status !== "all") query = query.eq("status", params.status);
  if (params.type !== "all") query = query.eq("source_type", params.type);
  if (params.q) query = query.ilike("title", `%${escapeLike(params.q)}%`);
  const [column, ascending] = params.sort === "name" ? ["title", true] : ["created_at", params.sort === "old"];
  const { data, error } = await query
    .order(column, { ascending })
    .order("id", { ascending: true })
    .limit(LIBRARY_LIMIT);
  if (error) throw new Error("library_sources_failed");
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const folder = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      folderId: row.project_id,
      folderName: folder?.name ?? "",
      title: row.title,
      sourceType: row.source_type,
      status: row.status,
      createdAt: row.created_at,
    };
  });
}
