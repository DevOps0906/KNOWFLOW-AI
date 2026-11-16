import type { SupabaseClient } from "@supabase/supabase-js";

// nomad DB(org안): knowflow 데이터의 소유는 조직이다. 조직 목록은 코어 공통 RPC(public.nomad_my_organizations)로 읽는다.
// 쓰기 역할은 DB(nomad_knowflow_private.can_write)와 같은 기준이다. 최종 판정은 항상 DB가 한 번 더 한다.

const WRITE_ROLES = new Set(["owner", "admin", "editor"]);

export interface MyOrganization {
  id: string;
  name: string;
  kind: "personal" | "team";
  role: "owner" | "admin" | "editor" | "viewer";
}

export async function myOrganizations(supabase: SupabaseClient): Promise<MyOrganization[]> {
  const { data, error } = await supabase.schema("public").rpc("nomad_my_organizations");
  if (error) throw new Error("organizations_lookup_failed");
  return (data ?? []) as MyOrganization[];
}

/** 새 프로젝트를 만들 조직: 개인 조직(가입 때 자동 생성) → 없으면 쓰기 역할인 첫 조직. 없으면 null */
export async function defaultWritableOrganization(supabase: SupabaseClient): Promise<string | null> {
  const writable = (await myOrganizations(supabase)).filter((o) => WRITE_ROLES.has(o.role));
  return (writable.find((o) => o.kind === "personal") ?? writable[0])?.id ?? null;
}

/** RLS로 보이는(멤버) 삭제되지 않은 프로젝트이고 세션 사용자가 그 조직의 쓰기 역할이면 조직 id, 아니면 null */
export async function writableProjectOrganization(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("project_lookup_failed");
  const organizationId = (data as { organization_id: string } | null)?.organization_id;
  if (!organizationId) return null;
  const org = (await myOrganizations(supabase)).find((o) => o.id === organizationId);
  return org && WRITE_ROLES.has(org.role) ? organizationId : null;
}
