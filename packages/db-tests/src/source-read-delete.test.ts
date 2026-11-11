import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPool } from "../../../apps/worker/src/db";
import { admin, as, createProject, createUser, dbUrl, failure } from "./db";

// task-012a: 원문 청크 조회(get_source_chunks)와 자료 소프트 삭제(delete_sources) RPC.

interface ChunkPage {
  chunks: Array<{ id: string; chunk_index: number; content: string; locator: Record<string, unknown> }>;
  has_more: boolean;
  has_before: boolean;
  around: "found" | "not_found" | null;
  unavailable: boolean;
}

async function createSource(userId: string, projectId: string, opts: { status?: string; chunks?: number } = {}) {
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, status)
     values ($1, $2, 'url', '자료', 'https://example.test/a', $3) returning id`,
    [projectId, userId, opts.status ?? "completed"],
  );
  const sourceId = r.rows[0]!.id;
  if (opts.chunks) {
    await admin(
      `insert into public.source_chunks (source_id, project_id, chunk_index, content, locator)
       select $1, $2, i, '본문 ' || i, jsonb_build_object('page', i + 1) from generate_series(0, $3 - 1) i`,
      [sourceId, projectId, opts.chunks],
    );
  }
  return sourceId;
}

async function owner(opts: { status?: string; chunks?: number } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const sourceId = await createSource(uid, projectId, opts);
  return { uid, projectId, sourceId };
}

const chunks = (uid: string, sourceId: string, after: number | null, limit: number, around: string | null = null) =>
  as({ role: "authenticated", sub: uid }, async (c) =>
    (await c.query<{ r: ChunkPage }>("select public.get_source_chunks($1, $2, $3, $4) as r", [sourceId, after, limit, around])).rows[0]!.r,
  );
const chunksFailure = (uid: string, sourceId: string, limit = 10) =>
  failure({ role: "authenticated", sub: uid }, "select public.get_source_chunks($1, null, $2, null)", [sourceId, limit]);

const deleteSources = (uid: string, projectId: string, ids: string[]) =>
  as(
    { role: "authenticated", sub: uid },
    async (c) => (await c.query<{ n: number }>("select public.delete_sources($1, $2::uuid[]) as n", [projectId, ids])).rows[0]!.n,
    { commit: true },
  );
const deleteFailure = (uid: string, projectId: string, ids: unknown) =>
  failure({ role: "authenticated", sub: uid }, "select public.delete_sources($1, $2::uuid[])", [projectId, ids]);
const deletedAt = async (id: string) =>
  (await admin<{ deleted_at: Date | null }>("select deleted_at from public.sources where id = $1", [id])).rows[0]!.deleted_at;

const workerSql = async (sql: string, params: unknown[]) => {
  const pool = createPool({ databaseUrl: dbUrl(), dbRole: "service_role" }, (e) => {
    throw e;
  });
  try {
    return await pool.query(sql, params);
  } finally {
    await pool.end();
  }
};

describe("get_source_chunks", () => {
  it("타인·없는·삭제된 자료와 삭제된 프로젝트의 자료는 모두 P0002", async () => {
    const a = await owner({ chunks: 2 });
    const other = await createUser();
    expect((await chunksFailure(other, a.sourceId))?.code).toBe("P0002");
    expect((await chunksFailure(a.uid, randomUUID()))?.code).toBe("P0002");

    const b = await owner({ chunks: 2 });
    await admin("update public.sources set deleted_at = now() where id = $1", [b.sourceId]);
    expect((await chunksFailure(b.uid, b.sourceId))?.code).toBe("P0002");

    const c = await owner({ chunks: 2 });
    await admin("update public.projects set deleted_at = now() where id = $1", [c.projectId]);
    expect((await chunksFailure(c.uid, c.sourceId))?.code).toBe("P0002");
  });

  it("completed가 아니면 KF409", async () => {
    for (const status of ["queued", "processing", "failed"]) {
      const a = await owner({ status });
      expect((await chunksFailure(a.uid, a.sourceId))?.code).toBe("KF409");
    }
  });

  it("비활성(unavailable_at) 자료는 청크 0건 + unavailable", async () => {
    const a = await owner({ chunks: 3 });
    await admin("update public.sources set unavailable_at = now() where id = $1", [a.sourceId]);
    expect(await chunks(a.uid, a.sourceId, null, 10)).toEqual({
      chunks: [],
      has_more: false,
      has_before: false,
      around: null,
      unavailable: true,
    });
  });

  it("chunk_index keyset으로 이어 읽는다(id·content·locator 포함)", async () => {
    const a = await owner({ chunks: 5 });
    const p1 = await chunks(a.uid, a.sourceId, null, 2);
    expect(p1.chunks.map((x) => x.chunk_index)).toEqual([0, 1]);
    expect(p1.chunks[0]).toMatchObject({ content: "본문 0", locator: { page: 1 } });
    expect(p1).toMatchObject({ has_more: true, has_before: false, around: null, unavailable: false });
    const p2 = await chunks(a.uid, a.sourceId, 1, 2);
    expect(p2.chunks.map((x) => x.chunk_index)).toEqual([2, 3]);
    expect(p2).toMatchObject({ has_more: true, has_before: true });
    const p3 = await chunks(a.uid, a.sourceId, 3, 2);
    expect(p3.chunks.map((x) => x.chunk_index)).toEqual([4]);
    expect(p3.has_more).toBe(false);
  });

  it("페이지 상한은 100, 잘못된 입력은 22023", async () => {
    const a = await owner({ chunks: 120 });
    const page = await chunks(a.uid, a.sourceId, null, 100);
    expect(page.chunks).toHaveLength(100);
    expect(page.has_more).toBe(true);
    expect((await chunksFailure(a.uid, a.sourceId, 101))?.code).toBe("22023");
    expect((await chunksFailure(a.uid, a.sourceId, 0))?.code).toBe("22023");
    const both = await failure(
      { role: "authenticated", sub: a.uid },
      "select public.get_source_chunks($1, 0, 10, $2)",
      [a.sourceId, randomUUID()],
    );
    expect(both?.code).toBe("22023");
  });

  it("around는 대상 청크 앞뒤 창을 주고, 다른 자료의 청크 id면 처음부터 + not_found", async () => {
    const a = await owner({ chunks: 10 });
    const target = (await admin<{ id: string }>(
      "select id from public.source_chunks where source_id = $1 and chunk_index = 6",
      [a.sourceId],
    )).rows[0]!.id;
    const win = await chunks(a.uid, a.sourceId, null, 4, target);
    expect(win.chunks.map((x) => x.chunk_index)).toEqual([4, 5, 6, 7]);
    expect(win).toMatchObject({ around: "found", has_before: true, has_more: true });

    const b = await owner({ chunks: 3 });
    const miss = await chunks(b.uid, b.sourceId, null, 4, target);
    expect(miss.chunks.map((x) => x.chunk_index)).toEqual([0, 1, 2]);
    expect(miss).toMatchObject({ around: "not_found", has_before: false, has_more: false });
  });

  it("anon은 호출할 수 없다", async () => {
    const a = await owner({ chunks: 1 });
    const r = await failure({ role: "anon" }, "select public.get_source_chunks($1, null, 10, null)", [a.sourceId]);
    expect(r?.code).toBe("42501");
  });
});

describe("delete_sources", () => {
  it("하나라도 타인·없는 id면 전체를 거부하고 아무것도 지우지 않는다", async () => {
    const a = await owner();
    const b = await owner();
    expect((await deleteFailure(a.uid, a.projectId, [a.sourceId, b.sourceId]))?.code).toBe("P0002");
    expect((await deleteFailure(a.uid, a.projectId, [a.sourceId, randomUUID()]))?.code).toBe("P0002");
    // 다른 프로젝트(본인 것)의 자료도 거부
    const otherProject = await createProject(a.uid);
    const elsewhere = await createSource(a.uid, otherProject);
    expect((await deleteFailure(a.uid, a.projectId, [a.sourceId, elsewhere]))?.code).toBe("P0002");
    expect(await deletedAt(a.sourceId)).toBeNull();
    expect(await deletedAt(b.sourceId)).toBeNull();
  });

  it("타인·삭제된 프로젝트는 P0002, 빈 목록·null 포함은 22023", async () => {
    const a = await owner();
    const other = await createUser();
    expect((await deleteFailure(other, a.projectId, [a.sourceId]))?.code).toBe("P0002");
    expect((await deleteFailure(a.uid, a.projectId, []))?.code).toBe("22023");
    expect((await deleteFailure(a.uid, a.projectId, [a.sourceId, null]))?.code).toBe("22023");
    await admin("update public.projects set deleted_at = now() where id = $1", [a.projectId]);
    expect((await deleteFailure(a.uid, a.projectId, [a.sourceId]))?.code).toBe("P0002");
  });

  it("본인이 이미 지운 id는 성공(멱등)하고, 지운 자료는 목록·청크 조회에서 빠진다", async () => {
    const a = await owner({ chunks: 2 });
    const second = await createSource(a.uid, a.projectId);
    expect(await deleteSources(a.uid, a.projectId, [a.sourceId, a.sourceId])).toBe(1);
    expect(await deleteSources(a.uid, a.projectId, [a.sourceId, second])).toBe(1);
    expect(await deleteSources(a.uid, a.projectId, [a.sourceId, second])).toBe(0);
    const visible = await as({ role: "authenticated", sub: a.uid }, (c) =>
      c.query("select id from public.sources where project_id = $1", [a.projectId]),
    );
    expect(visible.rows).toEqual([]);
    expect((await chunksFailure(a.uid, a.sourceId))?.code).toBe("P0002");
    // 청크는 남긴다(영구 삭제는 task-019)
    expect((await admin("select 1 from public.source_chunks where source_id = $1", [a.sourceId])).rowCount).toBe(2);
  });

  it("진행 중 작업이 있어도 지우고, Worker의 청크 쓰기는 거부되며 source_deleted 실패는 환불된다", async () => {
    const a = await owner({ status: "processing" });
    await admin("update public.user_quotas set used_source_jobs = 1 where user_id = $1", [a.uid]);
    const job = await admin<{ id: string }>(
      `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
       values ($1, $2, 'source_ingest', 'running', 1, now() + interval '1 minute') returning id`,
      [a.uid, a.sourceId],
    );
    const jobId = job.rows[0]!.id;
    expect(await deleteSources(a.uid, a.projectId, [a.sourceId])).toBe(1);

    const chunk = JSON.stringify([{ chunk_index: 0, content: "늦은 청크", locator: {} }]);
    const replaced = await workerSql("select public.replace_source_chunks($1, 1, $2::jsonb) as ok", [jobId, chunk]);
    expect(replaced.rows[0]!.ok).toBe(false);
    expect((await admin("select 1 from public.source_chunks where source_id = $1", [a.sourceId])).rowCount).toBe(0);

    const failed = await workerSql("select public.fail_job($1, 1, 'source_deleted', false) as r", [jobId]);
    expect(failed.rows[0]!.r).toBe("failed");
    const quota = await admin<{ used_source_jobs: number }>("select used_source_jobs from public.user_quotas where user_id = $1", [a.uid]);
    expect(quota.rows[0]!.used_source_jobs).toBe(0);
  });
});
