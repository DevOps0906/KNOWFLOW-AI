import { encodeCursor, parseListParams, type ListParams } from "./params";
import type { Outcome, ProjectItem, ProjectPatch } from "./types";

export interface ProjectsBackend {
  getUserId(): Promise<string | null>;
  list(params: ListParams): Promise<{ items: ProjectItem[]; hasMore: boolean }>;
  create(input: { name: string; description: string | null }): Promise<Outcome<ProjectItem>>;
  update(id: string, patch: ProjectPatch): Promise<Outcome<ProjectItem>>;
  remove(id: string): Promise<Outcome<{ deletedAt: string }>>;
}

export interface ProjectsDeps {
  backend: ProjectsBackend;
  /** Origin 검사 기준(쓰기 요청). 없으면 검사를 건너뛴다(proxy가 로그인은 이미 확인). */
  siteUrl?: string | undefined;
}

export const PROJECT_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  invalidRequest: "요청을 처리할 수 없습니다. 입력 내용을 확인해 주세요.",
  invalidName: "프로젝트 이름은 1~100자로 입력해 주세요.",
  invalidDescription: "설명은 1000자 이하로 입력해 주세요.",
  notFound: "프로젝트를 찾을 수 없습니다.",
  limit: "프로젝트는 최대 20개까지 만들 수 있습니다. 쓰지 않는 프로젝트를 삭제한 뒤 다시 시도해 주세요.",
  conflict: "처리 중인 작업이 있어 삭제할 수 없습니다. 작업이 끝난 뒤 다시 시도해 주세요.",
  server: "일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: NO_STORE });
}
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

class Stop extends Error {
  constructor(readonly response: Response) {
    super("stop");
  }
}

function outcomeError(kind: Exclude<Outcome<never>, { ok: true }>["kind"]) {
  switch (kind) {
    case "unauthorized":
      return fail(401, "unauthorized", PROJECT_MESSAGES.unauthorized);
    case "not_found":
      return fail(404, "not_found", PROJECT_MESSAGES.notFound);
    case "invalid":
      return fail(422, "invalid_input", PROJECT_MESSAGES.invalidName);
    case "limit":
      return fail(429, "project_limit", PROJECT_MESSAGES.limit);
    case "conflict":
      return fail(409, "has_active_jobs", PROJECT_MESSAGES.conflict);
    default:
      return fail(500, "server_error", PROJECT_MESSAGES.server);
  }
}

export function createProjectHandlers(deps: ProjectsDeps) {
  const { backend } = deps;

  async function requireUser() {
    const id = await backend.getUserId();
    if (!id) throw new Stop(fail(401, "unauthorized", PROJECT_MESSAGES.unauthorized));
  }

  function checkOrigin(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && deps.siteUrl && origin !== new URL(deps.siteUrl).origin) {
      throw new Stop(fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest));
    }
  }

  async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new Stop(fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest));
    }
    const text = await request.text();
    if (text.length <= 16_384) {
      try {
        const body: unknown = JSON.parse(text);
        if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
      } catch {
        // 아래에서 400
      }
    }
    throw new Stop(fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest));
  }

  /** 문자열이면 다듬어서, null이면 null로. 그 밖의 형식은 undefined. */
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : v === null ? null : undefined);

  function validName(v: unknown): string | null {
    return typeof v === "string" && v.trim().length >= 1 && Array.from(v.trim()).length <= 100 ? v.trim() : null;
  }
  const validDescription = (v: string) => Array.from(v).length <= 1000;

  async function run(fn: () => Promise<Response>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Stop) return e.response;
      return fail(500, "server_error", PROJECT_MESSAGES.server);
    }
  }

  return {
    list: (request: Request) =>
      run(async () => {
        await requireUser();
        const params = parseListParams(new URL(request.url).searchParams);
        if (!params) return fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest);
        const { items, hasMore } = await backend.list(params);
        return json(200, { items, next_cursor: hasMore ? encodeCursor(params.offset + params.limit) : null });
      }),

    create: (request: Request) =>
      run(async () => {
        checkOrigin(request);
        await requireUser();
        const body = await readJson(request);
        // 본문의 user_id 등 다른 키는 읽지 않는다. 소유자는 DB가 세션에서 정한다.
        const name = validName(body.name);
        if (!name) return fail(422, "invalid_name", PROJECT_MESSAGES.invalidName);
        const description = body.description === undefined ? null : text(body.description);
        if (description === undefined || (description !== null && !validDescription(description))) {
          return fail(422, "invalid_description", PROJECT_MESSAGES.invalidDescription);
        }
        const result = await backend.create({ name, description: description || null });
        return result.ok ? json(201, result.data) : outcomeError(result.kind);
      }),

    update: (request: Request, projectId: string) =>
      run(async () => {
        checkOrigin(request);
        await requireUser();
        if (!UUID.test(projectId)) return fail(404, "not_found", PROJECT_MESSAGES.notFound);
        const body = await readJson(request);
        const patch: ProjectPatch = {};
        if ("name" in body) {
          const name = validName(body.name);
          if (!name) return fail(422, "invalid_name", PROJECT_MESSAGES.invalidName);
          patch.name = name;
        }
        if ("description" in body) {
          const description = text(body.description);
          if (description === undefined || (description !== null && !validDescription(description))) {
            return fail(422, "invalid_description", PROJECT_MESSAGES.invalidDescription);
          }
          patch.description = description || null;
        }
        if ("archived" in body) {
          if (typeof body.archived !== "boolean") return fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest);
          patch.archived = body.archived;
        }
        if (Object.keys(patch).length === 0) return fail(400, "bad_request", PROJECT_MESSAGES.invalidRequest);
        const result = await backend.update(projectId, patch);
        return result.ok ? json(200, result.data) : outcomeError(result.kind);
      }),

    remove: (request: Request, projectId: string) =>
      run(async () => {
        checkOrigin(request);
        await requireUser();
        if (!UUID.test(projectId)) return fail(404, "not_found", PROJECT_MESSAGES.notFound);
        const result = await backend.remove(projectId);
        return result.ok ? json(200, { ok: true, deletedAt: result.data.deletedAt }) : outcomeError(result.kind);
      }),
  };
}
