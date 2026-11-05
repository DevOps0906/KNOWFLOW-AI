import { redirect } from "next/navigation";
import type { ListParams } from "./params";
import { listProjects } from "./queries";
import { serverSupabaseOrNull } from "./server";
import type { ProjectItem } from "./types";

export type LoadResult =
  | { state: "ok"; items: ProjectItem[]; hasMore: boolean }
  | { state: "error" };

/** 서버 컴포넌트용 목록 읽기. 로그인 사용자가 없으면 로그인 화면으로 보낸다(proxy가 먼저 막는 것이 정상). */
export async function loadProjects(params: ListParams): Promise<LoadResult> {
  try {
    const supabase = await serverSupabaseOrNull();
    if (!supabase) return { state: "error" };
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/login");
    const { items, hasMore } = await listProjects(supabase, params);
    return { state: "ok", items, hasMore };
  } catch (e) {
    // redirect()는 예외로 동작하므로 다시 던진다
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return { state: "error" };
  }
}
