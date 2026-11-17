import { listProjects } from "./queries";
import { serverSupabaseOrNull } from "./server";

// 폴더 = projects(이름만 바뀜, 스키마 유지). 앱 셸 사이드바·가져오기·라이브러리가 함께 쓴다.
export interface FolderOption {
  id: string;
  name: string;
}

/** 서버 컴포넌트용: 활성 폴더를 이름순으로. 읽지 못하면 null(로그인 확인은 proxy·각 화면이 한다). */
export async function loadFolders(): Promise<FolderOption[] | null> {
  try {
    const supabase = await serverSupabaseOrNull();
    if (!supabase) return null;
    const { items } = await listProjects(supabase, { q: "", status: "active", sort: "name", limit: 50, offset: 0 });
    return items.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return null;
  }
}
