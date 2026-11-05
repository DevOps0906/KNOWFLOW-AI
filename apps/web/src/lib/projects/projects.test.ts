import { describe, expect, it, vi } from "vitest";
import { createProjectHandlers, type ProjectsBackend } from "./handlers";
import { decodeCursor, encodeCursor, parseListParams } from "./params";
import { escapeLike, toItem } from "./queries";
import type { ProjectItem } from "./types";

const SITE = "https://app.example.test";
const ID = "3f1c2a54-8f0b-4a76-9b1d-0c5e7d9a1b22";
const item: ProjectItem = {
  id: ID,
  name: "프로젝트",
  description: null,
  status: "active",
  sourceCount: 0,
  createdAt: "2026-11-03T00:00:00Z",
  updatedAt: "2026-11-03T00:00:00Z",
};

function setup(overrides: Partial<ProjectsBackend> = {}) {
  const backend: ProjectsBackend = {
    getUserId: vi.fn(async () => "user-a"),
    list: vi.fn(async () => ({ items: [item], hasMore: false })),
    create: vi.fn(async () => ({ ok: true as const, data: item })),
    update: vi.fn(async () => ({ ok: true as const, data: item })),
    remove: vi.fn(async () => ({ ok: true as const, data: { deletedAt: "2026-11-03T00:00:00Z" } })),
    ...overrides,
  };
  return { backend, handlers: createProjectHandlers({ backend, siteUrl: SITE }) };
}

const send = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/projects`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

describe("프로젝트 생성(A-02 POST)", () => {
  it("요청 본문의 user_id는 무시하고 이름·설명만 DB로 넘긴다", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.create(send("POST", { name: "  새 프로젝트 ", description: " 설명 ", user_id: "someone-else", id: "x" }));
    expect(res.status).toBe(201);
    expect(backend.create).toHaveBeenCalledWith({ name: "새 프로젝트", description: "설명" });
  });

  it("이름이 비었거나 100자를 넘으면 422", async () => {
    const { handlers, backend } = setup();
    for (const name of ["", "   ", "가".repeat(101), 5, null, undefined]) {
      expect((await handlers.create(send("POST", { name }))).status).toBe(422);
    }
    expect((await handlers.create(send("POST", { name: "ok", description: "x".repeat(1001) }))).status).toBe(422);
    expect(backend.create).not.toHaveBeenCalled();
  });

  it("21번째 생성은 429(한도 초과 결과를 그대로 전달)", async () => {
    const { handlers } = setup({ create: async () => ({ ok: false, kind: "limit" }) });
    const res = await handlers.create(send("POST", { name: "21번째" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("project_limit");
  });

  it("로그인하지 않으면 401, 다른 Origin이면 400, JSON이 아니면 400", async () => {
    expect((await setup({ getUserId: async () => null }).handlers.create(send("POST", { name: "a" }))).status).toBe(401);
    const { handlers, backend } = setup();
    expect((await handlers.create(send("POST", { name: "a" }, { origin: "https://evil.test" }))).status).toBe(400);
    expect((await handlers.create(send("POST", "{bad"))).status).toBe(400);
    expect((await handlers.create(send("POST", "name=a", { "content-type": "text/plain" }))).status).toBe(400);
    expect(backend.create).not.toHaveBeenCalled();
  });
});

describe("수정·삭제(A-03 PATCH·DELETE)", () => {
  it("사용자 A가 사용자 B의 프로젝트를 수정·삭제하면 404", async () => {
    const notFound = { ok: false as const, kind: "not_found" as const };
    const { handlers } = setup({ update: async () => notFound, remove: async () => notFound });
    expect((await handlers.update(send("PATCH", { name: "탈취" }), ID)).status).toBe(404);
    expect((await handlers.remove(send("DELETE"), ID)).status).toBe(404);
  });

  it("id 형식이 틀리면 DB를 부르지 않고 404", async () => {
    const { handlers, backend } = setup();
    expect((await handlers.update(send("PATCH", { name: "a" }), "not-a-uuid")).status).toBe(404);
    expect((await handlers.remove(send("DELETE"), "../etc")).status).toBe(404);
    expect(backend.update).not.toHaveBeenCalled();
    expect(backend.remove).not.toHaveBeenCalled();
  });

  it("허용된 키만 패치로 넘기고 user_id·알 수 없는 키는 버린다", async () => {
    const { handlers, backend } = setup();
    await handlers.update(send("PATCH", { name: " 새 이름 ", archived: true, user_id: "x", deleted_at: null }), ID);
    expect(backend.update).toHaveBeenCalledWith(ID, { name: "새 이름", archived: true });
  });

  it("빈 패치·잘못된 형식은 거부한다", async () => {
    const { handlers } = setup();
    expect((await handlers.update(send("PATCH", {}), ID)).status).toBe(400);
    expect((await handlers.update(send("PATCH", { user_id: "x" }), ID)).status).toBe(400);
    expect((await handlers.update(send("PATCH", { archived: "yes" }), ID)).status).toBe(400);
    expect((await handlers.update(send("PATCH", { name: "" }), ID)).status).toBe(422);
  });

  it("처리 중 작업이 있으면 삭제는 409", async () => {
    const { handlers } = setup({ remove: async () => ({ ok: false, kind: "conflict" }) });
    const res = await handlers.remove(send("DELETE"), ID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("has_active_jobs");
  });

  it("알 수 없는 오류는 내부 정보 없이 500", async () => {
    const { handlers } = setup({ remove: async () => ({ ok: false, kind: "unknown" }) });
    const res = await handlers.remove(send("DELETE"), ID);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/sql|postgres|stack/i);
  });
});

describe("목록(A-02 GET)", () => {
  const get = (qs: string) => new Request(`${SITE}/api/projects${qs}`);

  it("다음 쪽이 있으면 next_cursor를 돌려주고 커서로 오프셋을 이어간다", async () => {
    const list = vi.fn(async () => ({ items: [item], hasMore: true }));
    const { handlers } = setup({ list });
    const first = await (await handlers.list(get("?limit=1"))).json();
    expect(first.next_cursor).toBeTruthy();
    await handlers.list(get(`?limit=1&cursor=${first.next_cursor}`));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1, limit: 1 }));
  });

  it("잘못된 파라미터는 400", async () => {
    const { handlers } = setup();
    for (const qs of ["?status=weird", "?sort=drop", "?limit=0", "?limit=999", "?cursor=@@@", `?q=${"a".repeat(101)}`]) {
      expect((await handlers.list(get(qs))).status).toBe(400);
    }
  });
});

describe("params · queries", () => {
  it("커서는 왕복되고 손상된 값은 null", () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(Buffer.from('{"o":-1}').toString("base64url"))).toBeNull();
  });

  it("화면용 lenient 모드는 잘못된 값을 기본값으로 바꾼다", () => {
    expect(parseListParams({ status: "x", sort: "y", limit: "9999", cursor: "bad" }, { lenient: true })).toEqual({
      q: "",
      status: "active",
      sort: "updated",
      limit: 20,
      offset: 0,
    });
  });

  it("LIKE 특수문자는 이스케이프한다", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("행을 화면용 항목으로 바꾼다(보관 상태·자료 수)", () => {
    const row = { id: ID, name: "n", description: null, archived_at: "2026-11-01", created_at: "c", updated_at: "u", sources: [{ count: 3 }] };
    expect(toItem(row)).toMatchObject({ status: "archived", sourceCount: 3 });
    expect(toItem({ ...row, archived_at: null, sources: undefined })).toMatchObject({ status: "active", sourceCount: 0 });
  });
});
