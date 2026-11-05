import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListParams } from "./params";
import type { Outcome, ProjectItem, ProjectPatch } from "./types";

// 읽기는 로그인 사용자의 세션으로 RLS를 통해서만 한다(본인·삭제되지 않은 행만 보인다).
// 쓰기는 DB RPC(create_project·update_project·delete_project)만 쓴다. user_id는 어디에서도 넘기지 않는다.

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  sources?: Array<{ count: number }>;
}

const SORT_COLUMN = { updated: ["updated_at", false], created: ["created_at", false], name: ["name", true] } as const;

export function toItem(row: ProjectRow): ProjectItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.archived_at ? "archived" : "active",
    sourceCount: row.sources?.[0]?.count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** LIKE 특수문자를 문자 그대로 검색하도록 이스케이프 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listProjects(
  supabase: SupabaseClient,
  params: ListParams,
): Promise<{ items: ProjectItem[]; hasMore: boolean }> {
  let query = supabase
    .from("projects")
    .select("id, name, description, archived_at, created_at, updated_at, sources(count)")
    .is("deleted_at", null)
    .is("sources.deleted_at", null);
  if (params.status === "active") query = query.is("archived_at", null);
  if (params.status === "archived") query = query.not("archived_at", "is", null);
  if (params.q) query = query.ilike("name", `%${escapeLike(params.q)}%`);
  const [column, ascending] = SORT_COLUMN[params.sort];
  const { data, error } = await query
    .order(column, { ascending })
    .order("id", { ascending: true })
    .range(params.offset, params.offset + params.limit); // limit + 1개를 읽어 다음 쪽 여부를 안다
  if (error) throw new Error("projects_list_failed");
  const rows = (data ?? []) as unknown as ProjectRow[];
  return { items: rows.slice(0, params.limit).map(toItem), hasMore: rows.length > params.limit };
}

function classify(error: { code?: string }): Exclude<Outcome<never>, { ok: true }> {
  switch (error.code) {
    case "28000":
      return { ok: false, kind: "unauthorized" };
    case "P0002":
      return { ok: false, kind: "not_found" };
    case "22023":
      return { ok: false, kind: "invalid" };
    case "KF429":
      return { ok: false, kind: "limit" };
    case "KF409":
      return { ok: false, kind: "conflict" };
    default:
      return { ok: false, kind: "unknown" };
  }
}

export async function createProject(
  supabase: SupabaseClient,
  input: { name: string; description: string | null },
): Promise<Outcome<ProjectItem>> {
  const { data, error } = await supabase.rpc("create_project", { p_name: input.name, p_description: input.description });
  if (error) return classify(error);
  return { ok: true, data: toItem(data as ProjectRow) };
}

export async function updateProject(supabase: SupabaseClient, id: string, patch: ProjectPatch): Promise<Outcome<ProjectItem>> {
  const { data, error } = await supabase.rpc("update_project", { p_id: id, p_patch: patch });
  if (error) return classify(error);
  return { ok: true, data: toItem(data as ProjectRow) };
}

export async function deleteProject(supabase: SupabaseClient, id: string): Promise<Outcome<{ deletedAt: string }>> {
  const { data, error } = await supabase.rpc("delete_project", { p_id: id });
  if (error) return classify(error);
  return { ok: true, data: { deletedAt: String(data) } };
}
