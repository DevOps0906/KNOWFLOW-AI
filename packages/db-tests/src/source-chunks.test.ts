import { describe, expect, it } from "vitest";
import { createPool } from "../../../apps/worker/src/db";
import { createPgIngestStore } from "../../../apps/worker/src/ingest/store";
import { PermanentError } from "../../../apps/worker/src/runner";
import { admin, createProject, createUser, dbUrl, failure } from "./db";

// task-011: 펜싱된 청크 교체 RPC와 Worker 저장소(createPgIngestStore)를 실제 DB로 확인한다.

async function runningJob(opts: { attempt?: number } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const source = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, storage_path, content_hash)
     values ($1, $2, 'pdf', '자료', $3, $4) returning id`,
    [projectId, uid, `${uid}/${projectId}/a.pdf`, "a".repeat(64)],
  );
  const sourceId = source.rows[0]!.id;
  const job = await admin<{ id: string }>(
    `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
     values ($1, $2, 'source_ingest', 'running', $3, now() + interval '1 minute') returning id`,
    [uid, sourceId, opts.attempt ?? 1],
  );
  return { uid, projectId, sourceId, jobId: job.rows[0]!.id };
}

const chunk = (i: number, text: string, page = 1) => ({ chunk_index: i, content: text, locator: { page, char_start: 0, char_end: text.length } });
const chunksJson = (n: number, prefix = "본문") => JSON.stringify(Array.from({ length: n }, (_, i) => chunk(i, `${prefix} ${i} 한국어 검색`)));

const workerSql = async (sql: string, params: unknown[]) => {
  // service_role로 RPC를 부른다(테스트 연결은 superuser라 SET ROLE 한다)
  const pool = createPool({ databaseUrl: dbUrl(), dbRole: "service_role" }, (e) => {
    throw e;
  });
  try {
    return await pool.query(sql, params);
  } finally {
    await pool.end();
  }
};
const replace = async (jobId: string, attempt: number, chunks: string) =>
  (await workerSql("select public.replace_source_chunks($1, $2, $3::jsonb) as ok", [jobId, attempt, chunks])).rows[0]!.ok as boolean;
const chunkRows = async (sourceId: string) =>
  (await admin<{ chunk_index: number; content: string; embedding_model: string | null; tsv: boolean; page: number }>(
    `select chunk_index, content, embedding_model, content_tsv is not null and content_tsv <> ''::tsvector as tsv, (locator ->> 'page')::int as page
       from public.source_chunks where source_id = $1 order by chunk_index`,
    [sourceId],
  )).rows;

describe("replace_source_chunks", () => {
  it("같은 자료를 다시 처리하면 청크를 통째로 바꿔 중복이 없다(embedding_model은 NULL, content_tsv는 생성)", async () => {
    const { jobId, sourceId } = await runningJob();
    expect(await replace(jobId, 1, chunksJson(3, "첫"))).toBe(true);
    expect(await replace(jobId, 1, chunksJson(2, "둘"))).toBe(true);
    const rows = await chunkRows(sourceId);
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1]);
    expect(rows.every((r) => r.content.startsWith("둘") && r.embedding_model === null && r.tsv && r.page === 1)).toBe(true);
  });

  it("attempt가 다르면 거부하고 기존 청크를 건드리지 않는다", async () => {
    const { jobId, sourceId } = await runningJob({ attempt: 2 });
    expect(await replace(jobId, 2, chunksJson(2))).toBe(true);
    expect(await replace(jobId, 1, chunksJson(5, "오래된"))).toBe(false);
    expect((await chunkRows(sourceId)).length).toBe(2);
  });

  it("status가 running이 아니면 거부한다", async () => {
    for (const status of ["queued", "succeeded", "failed", "cancelled"]) {
      const { jobId, sourceId } = await runningJob();
      await admin(
        `update public.processing_jobs set status = $2, progress = case when $2 = 'succeeded' then 100 else progress end where id = $1`,
        [jobId, status],
      );
      expect(await replace(jobId, 1, chunksJson(1))).toBe(false);
      expect(await chunkRows(sourceId)).toEqual([]);
    }
  });

  it("청크 형식이 잘못되면 22023으로 거부한다", async () => {
    const { jobId } = await runningJob();
    for (const bad of ["{}", "[1]", JSON.stringify([{ chunk_index: 0, content: "", locator: {} }]), JSON.stringify([{ chunk_index: 0, content: "a", locator: [] }])]) {
      await expect(replace(jobId, 1, bad)).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("chunk_index가 정수가 아니거나 음수이거나 배열 안에서 겹치면 22023", async () => {
    const { jobId, sourceId } = await runningJob();
    const bad = [
      [{ ...chunk(0, "가"), chunk_index: 1.5 }],
      [{ ...chunk(0, "가"), chunk_index: -1 }],
      [{ ...chunk(0, "가"), chunk_index: "0" }],
      [{ ...chunk(0, "가"), chunk_index: 2147483648 }],
      [chunk(0, "가"), chunk(0, "나")],
    ];
    for (const b of bad) await expect(replace(jobId, 1, JSON.stringify(b))).rejects.toMatchObject({ code: "22023" });
    expect(await chunkRows(sourceId)).toEqual([]);
  });

  it("삭제된 자료(deleted_at)에는 쓰지 않고 false", async () => {
    const { jobId, sourceId } = await runningJob();
    await admin("update public.sources set deleted_at = now() where id = $1", [sourceId]);
    expect(await replace(jobId, 1, chunksJson(2))).toBe(false);
    expect(await chunkRows(sourceId)).toEqual([]);
  });

  it("service_role 전용: anon·authenticated는 실행할 수 없다", async () => {
    const { jobId, uid } = await runningJob();
    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, sub: uid }]) {
      const f = await failure(actor, "select public.replace_source_chunks($1, 1, '[]'::jsonb)", [jobId]);
      expect(f?.code).toBe("42501");
    }
  });
});

describe("Worker 저장소(createPgIngestStore)", () => {
  const store = () => {
    const p = createPool({ databaseUrl: dbUrl(), dbRole: "service_role" }, () => {});
    return { p, s: createPgIngestStore(p) };
  };

  it("청크 교체와 완료가 한 트랜잭션: 성공하면 job succeeded·자료 completed", async () => {
    const { jobId, sourceId } = await runningJob();
    const { p, s } = store();
    try {
      expect(await s.replaceChunksAndComplete(jobId, 1, [chunk(0, "본문 하나", 3)])).toBe(true);
    } finally {
      await p.end();
    }
    const job = await admin("select status from public.processing_jobs where id = $1", [jobId]);
    const src = await admin("select status from public.sources where id = $1", [sourceId]);
    expect([job.rows[0]!.status, src.rows[0]!.status]).toEqual(["succeeded", "completed"]);
    expect((await chunkRows(sourceId)).map((r) => r.page)).toEqual([3]);
  });

  it("청크 형식 거부(22023)는 PermanentError(invalid_chunks)로 닫고 job을 바꾸지 않는다", async () => {
    const { jobId } = await runningJob();
    const { p, s } = store();
    try {
      const e = await s.replaceChunksAndComplete(jobId, 1, [chunk(0, "가"), chunk(0, "나")]).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(PermanentError);
      expect((e as PermanentError).code).toBe("invalid_chunks");
    } finally {
      await p.end();
    }
    expect((await admin("select status from public.processing_jobs where id = $1", [jobId])).rows[0]!.status).toBe("running");
  });

  it("펜싱에 걸리면 아무것도 바꾸지 않는다", async () => {
    const { jobId, sourceId } = await runningJob({ attempt: 2 });
    const { p, s } = store();
    try {
      expect(await s.replaceChunksAndComplete(jobId, 1, [chunk(0, "본문")])).toBe(false);
    } finally {
      await p.end();
    }
    expect((await admin("select status from public.processing_jobs where id = $1", [jobId])).rows[0]!.status).toBe("running");
    expect(await chunkRows(sourceId)).toEqual([]);
  });

  it("첫 자료 요약은 summary가 비어 있을 때만 한 번 저장되고 사용 기록을 남긴다", async () => {
    const { uid, projectId } = await runningJob();
    const { p, s } = store();
    try {
      expect(await s.projectNeedsSummary(projectId)).toBe(true);
      const results = await Promise.all([
        s.saveInitialSummary(projectId, "요약 A", ["질문 A?"]),
        s.saveInitialSummary(projectId, "요약 B", ["질문 B?"]),
      ]);
      expect(results.filter(Boolean).length).toBe(1);
      expect(await s.projectNeedsSummary(projectId)).toBe(false);
      await s.recordUsage({ userId: uid, projectId, eventType: "project_summary", provider: "stub", model: "m", inputTokens: null, outputTokens: null });
    } finally {
      await p.end();
    }
    const proj = await admin<{ summary: string; q: number }>(
      "select summary, jsonb_array_length(suggested_questions) as q from public.projects where id = $1",
      [projectId],
    );
    expect(proj.rows[0]!.q).toBe(1);
    const usage = await admin("select count(*)::int as n from public.usage_events where project_id = $1 and event_type = 'project_summary'", [projectId]);
    expect(usage.rows[0]!.n).toBe(1);
  });
});

describe("한국어 키워드 검색 준비", () => {
  it("show_trgm('한국어')가 비어 있지 않다", async () => {
    const r = await admin<{ n: number }>("select cardinality(extensions.show_trgm('한국어')) as n");
    expect(r.rows[0]!.n).toBeGreaterThan(0);
  });
});
