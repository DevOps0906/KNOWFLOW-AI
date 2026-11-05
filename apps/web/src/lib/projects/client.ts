// 브라우저에서 /api/projects 를 부르는 공통 함수. 오류 형식은 {error:{code,message}}.
export interface ProjectCallResult {
  ok: boolean;
  status: number;
  message?: string;
  id?: string;
}

export async function callProjects(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<ProjectCallResult> {
  try {
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    return { ok: response.ok, status: response.status, message: data.error?.message, id: data.id };
  } catch {
    return { ok: false, status: 0, message: "네트워크 연결을 확인하고 다시 시도해 주세요." };
  }
}
