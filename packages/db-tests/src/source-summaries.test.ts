import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

// task-029a: source_summaries RLS, save_source_summary 펜싱, replace_source_chunks 재정의(요약 삭제).

const SERVICE = { role: "service_role" as const };
const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

async function setup() {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const src = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, storage_path, content_hash)
     values ($1, $2, 'pdf', '자료', $3, $4) returning id`,
    [projectId, uid, `${uid}/${projectId}/a.pdf`, randomUUID().replaceAll("-", "").repeat(2)],
  );
  return { uid, projectId, sourceId: src.rows[0]!.id };
}

async function addJob(uid: string, sourceId: string, status: "running" | "succeeded", attempt = 1) {
  const r = await admin<{ id: string }>(
    `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, progress, locked_until, finished_at)
     values ($1, $2, 'source_ingest', $3, $4, $5, $6, $7) returning id`,
    [uid, sourceId, status, attempt, status === "succeeded" ? 100 : 0, status === "running" ? new Date(Date.now() + 60_000) : null, status === "succeeded" ? new Date() : null],
  );
  return r.rows[0]!.id;
}

const chunkJson = (n: number, prefix = "본문") =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ chunk_index: i, content: `${prefix} ${i}`, locator: { t_start: i, t_end: i + 1 } })));

const replace = async (jobId: string, attempt: number, chunks: string) =>
  (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.replace_source_chunks($1, $2, $3::jsonb) as ok", [jobId, attempt, chunks]), { commit: true })).rows[0]!.ok;
const chunkIds = async (sourceId: string) =>
  (await admin<{ id: string }>("select id from public.source_chunks where source_id = $1 order by chunk_index", [sourceId])).rows.map((r) => r.id);
const save = async (jobId: string, sentences: unknown, model = "stub") =>
  (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.save_source_summary($1, $2::jsonb, $3) as ok", [jobId, JSON.stringify(sentences), model]), { commit: true })).rows[0]!.ok;
const summaryCount = async (sourceId: string) =>
  Number((await admin<{ n: string }>("select count(*) as n from public.source_summaries where source_id = $1", [sourceId])).rows[0]!.n);

/** 청크 2개가 있고 완료된 작업이 하나 있는 자료 */
async function ready() {
  const s = await setup();
  const running = await addJob(s.uid, s.sourceId, "running");
  expect(await replace(running, 1, chunkJson(2))).toBe(true);
  await admin("update public.processing_jobs set status = 'succeeded', progress = 100, finished_at = now(), locked_until = null where id = $1", [running]);
  return { ...s, jobId: running, ids: await chunkIds(s.sourceId) };
}

describe("source_summaries RLS", () => {
  it("소유자만 읽고, 쓰기 권한은 없다", async () => {
    const s = await ready();
    expect(await save(s.jobId, [{ text: "요약", chunk_ids: [s.ids[0]] }])).toBe(true);
    const sql = "select source_id from public.source_summaries where source_id = $1";
    expect((await as(asUser(s.uid), (c) => c.query(sql, [s.sourceId]))).rowCount).toBe(1);
    const other = await createUser();
    expect((await as(asUser(other), (c) => c.query(sql, [s.sourceId]))).rowCount).toBe(0);
    expect((await as({ role: "anon" }, (c) => c.query(sql, [s.sourceId]).catch(() => ({ rowCount: 0 })))).rowCount).toBe(0);
    const ins = "insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model) values ($1, $2, $3, $4, '[{}]', 'm')";
    expect((await failure(asUser(s.uid), ins, [s.sourceId, s.projectId, s.uid, s.jobId]))?.code).toBe("42501");
    expect((await failure(asUser(s.uid), "delete from public.source_summaries where source_id = $1", [s.sourceId]))?.code).toBe("42501");
  });

  it("unavailable_at·삭제된 자료의 요약은 보이지 않는다", async () => {
    const s = await ready();
    expect(await save(s.jobId, [{ text: "요약", chunk_ids: [s.ids[0]] }])).toBe(true);
    const sql = "select 1 from public.source_summaries where source_id = $1";
    await admin("update public.sources set unavailable_at = now() where id = $1", [s.sourceId]);
    expect((await as(asUser(s.uid), (c) => c.query(sql, [s.sourceId]))).rowCount).toBe(0);
    await admin("update public.sources set unavailable_at = null where id = $1", [s.sourceId]);
    expect((await as(asUser(s.uid), (c) => c.query(sql, [s.sourceId]))).rowCount).toBe(1);
    await admin("update public.sources set deleted_at = now() where id = $1", [s.sourceId]);
    expect((await as(asUser(s.uid), (c) => c.query(sql, [s.sourceId]))).rowCount).toBe(0);
  });
});

describe("save_source_summary", () => {
  it("최신 완료 작업·현재 청크 인용이면 저장하고 다시 저장하면 덮어쓴다", async () => {
    const s = await ready();
    expect(await save(s.jobId, [{ text: "첫", chunk_ids: [s.ids[0]] }])).toBe(true);
    expect(await save(s.jobId, [{ text: "둘", chunk_ids: [s.ids[1]] }], "m2")).toBe(true);
    const r = await admin<{ sentences: { text: string }[]; model: string; user_id: string }>(
      "select sentences, model, user_id from public.source_summaries where source_id = $1",
      [s.sourceId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.sentences[0]!.text).toBe("둘");
    expect(r.rows[0]!.model).toBe("m2");
    expect(r.rows[0]!.user_id).toBe(s.uid);
  });

  it("문장마다 citations(chunk_id·t_start)를 함께 저장하고 t_start는 청크 locator와 같다", async () => {
    const s = await ready();
    expect(await save(s.jobId, [{ text: "하나", chunk_ids: [s.ids[1], s.ids[0]], citations: [{ chunk_id: "위조", t_start: 999 }] }])).toBe(true);
    const r = await admin<{ sentences: { chunk_ids: string[]; citations: { chunk_id: string; t_start: number }[] }[] }>(
      "select sentences from public.source_summaries where source_id = $1",
      [s.sourceId],
    );
    const sentence = r.rows[0]!.sentences[0]!;
    expect(sentence.chunk_ids).toEqual([s.ids[1], s.ids[0]]);
    // ready()의 청크 i는 locator.t_start = i
    expect(sentence.citations).toEqual([
      { chunk_id: s.ids[1], t_start: 1 },
      { chunk_id: s.ids[0], t_start: 0 },
    ]);
    for (const c of sentence.citations) {
      const k = await admin<{ t: string }>("select locator ->> 't_start' as t from public.source_chunks where id = $1", [c.chunk_id]);
      expect(Number(k.rows[0]!.t)).toBe(c.t_start);
    }
  });

  it("현재 청크가 아닌 ID(다른 자료 청크 포함)는 거부한다", async () => {
    const s = await ready();
    const o = await ready();
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [randomUUID()] }])).toBe(false);
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [s.ids[0], o.ids[0]] }])).toBe(false);
    expect(await summaryCount(s.sourceId)).toBe(0);
  });

  it("완료되지 않았거나 최신이 아닌 작업은 거부한다", async () => {
    const s = await setup();
    const running = await addJob(s.uid, s.sourceId, "running");
    await replace(running, 1, chunkJson(1));
    const ids = await chunkIds(s.sourceId);
    expect(await save(running, [{ text: "x", chunk_ids: ids }])).toBe(false); // 아직 running
    await admin("update public.processing_jobs set status = 'succeeded', progress = 100, finished_at = now() - interval '1 minute', locked_until = null where id = $1", [running]);
    const newer = await addJob(s.uid, s.sourceId, "succeeded");
    expect(await save(running, [{ text: "x", chunk_ids: ids }])).toBe(false); // 더 늦은 완료 작업이 있음
    expect(await save(newer, [{ text: "x", chunk_ids: ids }])).toBe(true);
    expect(await save(randomUUID(), [{ text: "x", chunk_ids: ids }])).toBe(false);
  });

  it("삭제·비활성 자료에는 저장하지 않는다", async () => {
    const s = await ready();
    await admin("update public.sources set unavailable_at = now() where id = $1", [s.sourceId]);
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [s.ids[0]] }])).toBe(false);
    await admin("update public.sources set unavailable_at = null, deleted_at = now() where id = $1", [s.sourceId]);
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [s.ids[0]] }])).toBe(false);
  });

  it("형식 오류는 22023, service_role 외에는 실행할 수 없다", async () => {
    const s = await ready();
    const bad = [[], [{ text: "", chunk_ids: [s.ids[0]] }], [{ text: "x", chunk_ids: [] }], [{ text: "x", chunk_ids: ["ABC"] }], [{ text: "x" }], {}];
    for (const b of bad) {
      expect((await failure(SERVICE, "select public.save_source_summary($1, $2::jsonb, 'm')", [s.jobId, JSON.stringify(b)]))?.code, JSON.stringify(b)).toBe("22023");
    }
    const tooLong = [{ text: "가".repeat(1001), chunk_ids: [s.ids[0]] }];
    expect((await failure(SERVICE, "select public.save_source_summary($1, $2::jsonb, 'm')", [s.jobId, JSON.stringify(tooLong)]))?.code).toBe("22023");
    for (const role of ["anon", "authenticated"] as const) {
      expect((await failure({ role }, "select public.save_source_summary($1, '[]'::jsonb, 'm')", [s.jobId]))?.code).toBe("42501");
    }
  });
});

describe("replace_source_chunks 재정의", () => {
  it("재처리하면 그 자료의 요약을 같은 트랜잭션에서 지우고, 다른 자료 요약은 건드리지 않는다", async () => {
    const s = await ready();
    const o = await ready();
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [s.ids[0]] }])).toBe(true);
    expect(await save(o.jobId, [{ text: "y", chunk_ids: [o.ids[0]] }])).toBe(true);
    const rerun = await addJob(s.uid, s.sourceId, "running", 2);
    expect(await replace(rerun, 2, chunkJson(3, "새"))).toBe(true);
    expect(await summaryCount(s.sourceId)).toBe(0);
    expect(await summaryCount(o.sourceId)).toBe(1);
    // 옛 청크 ID로는 저장할 수 없다
    await admin("update public.processing_jobs set status = 'succeeded', progress = 100, finished_at = now(), locked_until = null where id = $1", [rerun]);
    expect(await save(rerun, [{ text: "x", chunk_ids: [s.ids[0]] }])).toBe(false);
  });

  it("비활성(unavailable_at) 자료에는 false를 돌려주고 청크를 쓰지 않는다", async () => {
    const s = await setup();
    const job = await addJob(s.uid, s.sourceId, "running");
    await admin("update public.sources set unavailable_at = now() where id = $1", [s.sourceId]);
    expect(await replace(job, 1, chunkJson(2))).toBe(false);
    expect(await chunkIds(s.sourceId)).toEqual([]);
  });

  it("펜싱에 걸려 거부되면 요약을 지우지 않는다", async () => {
    const s = await ready();
    expect(await save(s.jobId, [{ text: "x", chunk_ids: [s.ids[0]] }])).toBe(true);
    const rerun = await addJob(s.uid, s.sourceId, "running", 2);
    expect(await replace(rerun, 1, chunkJson(1))).toBe(false); // attempt 불일치
    expect(await summaryCount(s.sourceId)).toBe(1);
  });
});
