import { createSupabaseServerClient, supabaseEnv } from "@/lib/auth/supabase-server";
import { createProjectHandlers, type ProjectsBackend } from "./handlers";
import { createProject, deleteProject, listProjects, updateProject } from "./queries";

// 서버 전용: 요청 쿠키에 묶인 Supabase 클라이언트로 핸들러를 조립한다(anon 키 + 사용자 세션, RLS 적용).
export async function projectHandlersForRequest() {
  const supabase = await createSupabaseServerClient();
  const backend: ProjectsBackend = {
    async getUserId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    list: (params) => listProjects(supabase, params),
    create: (input) => createProject(supabase, input),
    update: (id, patch) => updateProject(supabase, id, patch),
    remove: (id) => deleteProject(supabase, id),
  };
  return createProjectHandlers({ backend, siteUrl: process.env.NEXT_PUBLIC_SITE_URL });
}

/** 서버 컴포넌트용: 로그인한 사용자 확인 + 클라이언트. 환경 변수가 없으면 null. */
export async function serverSupabaseOrNull() {
  if (!supabaseEnv()) return null;
  return createSupabaseServerClient();
}
