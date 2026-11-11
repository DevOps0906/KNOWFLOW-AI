import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

async function createSource(userId: string, projectId: string): Promise<string> {
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url)
     values ($1, $2, 'url', '자료', 'https://example.test/a') returning id`,
    [projectId, userId],
  );
  return r.rows[0]!.id;
}

describe("sources.unavailable_at", () => {
  it("nullable timestamptz이고 기본값이 없다", async () => {
    const r = await admin(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'sources' and column_name = 'unavailable_at'`,
    );
    expect(r.rows).toEqual([
      { data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
    ]);
  });

  it("소유자만 읽을 수 있고 사용자는 설정할 수 없다", async () => {
    const owner = await createUser();
    const other = await createUser();
    const projectId = await createProject(owner);
    const sourceId = await createSource(owner, projectId);

    const ownerRows = await as({ role: "authenticated", sub: owner }, (c) =>
      c.query("select unavailable_at from public.sources where id = $1", [sourceId]),
    );
    expect(ownerRows.rows).toEqual([{ unavailable_at: null }]);

    const otherRows = await as({ role: "authenticated", sub: other }, (c) =>
      c.query("select unavailable_at from public.sources where id = $1", [sourceId]),
    );
    expect(otherRows.rows).toEqual([]);

    const update = await failure(
      { role: "authenticated", sub: owner },
      "update public.sources set unavailable_at = now() where id = $1",
      [sourceId],
    );
    expect(update?.code).toBe("42501");
  });
});
