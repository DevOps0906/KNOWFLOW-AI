import { projectHandlersForRequest } from "@/lib/projects/server";

// 기본 폴더 "받은 자료": 폴더를 고르지 않고 가져올 때 쓰는 폴더를 찾거나 만든다(소유자는 세션, RLS).
export async function POST(request: Request) {
  return (await projectHandlersForRequest()).inbox(request);
}
