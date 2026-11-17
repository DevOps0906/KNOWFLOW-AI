import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

// task-029a: source_summaries RLS, save_source_summary 저장 조건, replace_source_chunks 재정의(청크 교체 시 요약 삭제).

const SERVICE = { role: "service_role" as const };
const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

let seq = 0;
const newVideoId = () => `sum${String(++seq).padStart(4, "0")}${randomUUID().slice(0, 4)}`;

async function insertSource(uid: string, projectId: string, type: "youtube" | "pdf" | "url" = "youtube") {
  if (type === "url") {
    const r = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, original_url) values ($1, $2, 'url', '웹', 'https://example.test/a') returning id`,
      [projectId, uid],
    );
    return r.rows[0]!.id;
  }
  if (type === "pdf") {
    const r = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, storage_path) values ($1, $2, 'pdf', '문서', $3) returning id`,
      [projectId, uid, `${uid}/${projectId}/${randomUUID()}.pdf`],
    );
    return r.rows[0]!.id;
  }
  const videoId = newVideoId();
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, channel_title, duration_seconds, metadata_checked_at)
     values ($1, $2, 'youtube', '영상', $3, $4, '채널', 600, now()) returning id`,
    [projectId, uid, `https://www.youtube.com/watch?v=${videoId}`, videoId],
  );
  return r.rows[0]!.id;
}

const chunksJson = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ chunk_index: i, content: `전사 ${i}`, locator: { t_start: i * 10, t_end: i * 10 + 10 } })));

const call = async <T>(sql: string, params: unknown[]) =>
  (await as(SERVICE, (c) => c.query<{ r: T }>(sql, params), { commit: true })).rows[0]!.r;

/** running 작업을 만들고 청크를 넣어 완료한다 */
async function runIngest(uid: string, sourceId: string, n = 3) {
  const job = await admin<{ id: string }>(
    `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
     values ($1, $2, 'source_ingest', 'running', 1, now() + interval '1 minute') returning id`,
    [uid, sourceId],
  );
  const jobId = job.rows[0]!.id;
  expect(await call<boolean>("select public.replace_source_chunks($1, 1, $2::jsonb) as r", [jobId, chunksJson(n)])).toBe(true);
  expect(await call<boolean>("select public.complete_job($1, 1) as r", [jobId])).toBe(true);
  return jobId;
}

async function completedSource(opts: { type?: "youtube" | "pdf" | "url" } = {}) {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const sourceId = await insertSource(uid, projectId, opts.type);
  const jobId = await runIngest(uid, sourceId);
  return { uid, projectId, sourceId, jobId };
}

const chunkIds = async (sourceId: string) =>
  (await admin<{ id: string }>("select id from public.source_chunks where source_id = $1 order by chunk_index", [sourceId])).rows.map((r) => r.id);

const save = (jobId: string, sentences: unknown, model = "stub-video-summary-v1") =>
  call<boolean>("select public.save_source_summary($1, $2::jsonb, $3) as r", [jobId, JSON.stringify(sentences), model]);

const summaryRow = async (sourceId: string) =>
  (await admin<{ job_id: string; sentences: unknown; model: string; user_id: string; project_id: string }>(
    "select job_id, sentences, model, user_id, project_id from public.source_summaries where source_id = $1",
    [sourceId],
  )).rows[0];

describe("save_source_summary", () => {
  it("최신 완료 작업이고 청크가 그 자료의 것이면 저장하고(text는 앞뒤 공백 제거), 다시 부르면 덮어쓴다", async () => {
    const { uid, projectId, sourceId, jobId } = await completedSource();
    const [a, b] = await chunkIds(sourceId);
    expect(await save(jobId, [{ text: "  첫 문장 ", chunk_ids: [a] }, { text: "둘째", chunk_ids: [a, b] }])).toBe(true);
    expect(await summaryRow(sourceId)).toEqual({
      job_id: jobId,
      sentences: [
        { text: "첫 문장", chunk_ids: [a] },
        { text: "둘째", chunk_ids: [a, b] },
      ],
      model: "stub-video-summary-v1",
      user_id: uid,
      project_id: projectId,
    });
    expect(await save(jobId, [{ text: "새 요약", chunk_ids: [b] }], "m2")).toBe(true);
    expect((await summaryRow(sourceId))?.sentences).toEqual([{ text: "새 요약", chunk_ids: [b] }]);
  });

  it("다른 자료의 청크·없는 청크를 인용하면 false로 거부하고 기존 요약을 건드리지 않는다", async () => {
    const { sourceId, jobId } = await completedSource();
    const other = await completedSource();
    const [a] = await chunkIds(sourceId);
    const [foreign] = await chunkIds(other.sourceId);
    expect(await save(jobId, [{ text: "원래", chunk_ids: [a] }])).toBe(true);
    expect(await save(jobId, [{ text: "x", chunk_ids: [a, foreign] }])).toBe(false);
    expect(await save(jobId, [{ text: "x", chunk_ids: [randomUUID()] }])).toBe(false);
    expect((await summaryRow(sourceId))?.sentences).toEqual([{ text: "원래", chunk_ids: [a] }]);
  });

  it("완료되지 않은 작업·낡은 작업(더 늦게 끝난 작업 있음)·삭제·비활성 자료는 false", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    const newer = await runIngest(uid, sourceId);
    const ids = await chunkIds(sourceId);
    expect(await save(jobId, [{ text: "낡음", chunk_ids: [ids[0]] }])).toBe(false);
    expect(await save(newer, [{ text: "최신", chunk_ids: [ids[0]] }])).toBe(true);

    for (const status of ["queued", "running", "failed", "cancelled"]) {
      const s = await completedSource();
      await admin("update public.processing_jobs set status = $2, progress = 0 where id = $1", [s.jobId, status]);
      expect(await save(s.jobId, [{ text: "x", chunk_ids: [(await chunkIds(s.sourceId))[0]] }])).toBe(false);
    }
    const d = await completedSource();
    const [dc] = await chunkIds(d.sourceId);
    await admin("update public.sources set deleted_at = now() where id = $1", [d.sourceId]);
    expect(await save(d.jobId, [{ text: "x", chunk_ids: [dc] }])).toBe(false);
    const u = await completedSource();
    const [uc] = await chunkIds(u.sourceId);
    await admin("update public.sources set unavailable_at = now() where id = $1", [u.sourceId]);
    expect(await save(u.jobId, [{ text: "x", chunk_ids: [uc] }])).toBe(false);
    expect(await save(randomUUID(), [{ text: "x", chunk_ids: [uc] }])).toBe(false);
  });

  it("형식 오류·모델명 오류·유튜브/PDF가 아닌 자료(url)는 22023", async () => {
    const { sourceId, jobId } = await completedSource();
    const [a] = await chunkIds(sourceId);
    const ok = { text: "문장", chunk_ids: [a] };
    const bad: unknown[] = [
      {},
      [],
      Array.from({ length: 51 }, () => ok),
      [1],
      [{ ...ok, text: "   " }],
      [{ ...ok, text: "가".repeat(1001) }],
      [{ ...ok, text: 3 }],
      // 필수 키 누락(jsonb_typeof가 NULL → 비교가 NULL이 되어 통과하던 회귀)
      [{ chunk_ids: [a] }],
      [{ text: "문장" }],
      [{ ...ok, text: null }],
      [{ ...ok, chunk_ids: [] }],
      [{ ...ok, chunk_ids: a }],
      [{ ...ok, chunk_ids: [a.toUpperCase()] }],
      [{ ...ok, chunk_ids: [1] }],
      [{ ...ok, chunk_ids: Array.from({ length: 21 }, () => a) }],
    ];
    for (const b of bad) await expect(save(jobId, b)).rejects.toMatchObject({ code: "22023" });
    await expect(save(jobId, [ok], " ")).rejects.toMatchObject({ code: "22023" });
    expect(await summaryRow(sourceId)).toBeUndefined();

    const url = await completedSource({ type: "url" });
    const [uc] = await chunkIds(url.sourceId);
    await expect(save(url.jobId, [{ text: "x", chunk_ids: [uc] }])).rejects.toMatchObject({ code: "22023" });
    expect(await summaryRow(url.sourceId)).toBeUndefined();
  });

  it("PDF 자료도 저장한다(PDF 자료 요약)", async () => {
    const pdf = await completedSource({ type: "pdf" });
    const [pc] = await chunkIds(pdf.sourceId);
    expect(await save(pdf.jobId, [{ text: "문서 요약", chunk_ids: [pc] }])).toBe(true);
    expect((await summaryRow(pdf.sourceId))?.sentences).toEqual([{ text: "문서 요약", chunk_ids: [pc] }]);
  });

  it("service_role 전용: anon·authenticated는 42501", async () => {
    const { uid, jobId } = await completedSource();
    for (const actor of [{ role: "anon" as const }, asUser(uid)]) {
      const f = await failure(actor, "select public.save_source_summary($1, '[]'::jsonb, 'm')", [jobId]);
      expect(f?.code).toBe("42501");
    }
  });
});

describe("replace_source_chunks 재정의", () => {
  it("청크를 교체하면 그 자료의 요약을 지우고 다른 자료의 요약은 남긴다", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    const other = await completedSource();
    expect(await save(jobId, [{ text: "요약", chunk_ids: [(await chunkIds(sourceId))[0]] }])).toBe(true);
    expect(await save(other.jobId, [{ text: "다른", chunk_ids: [(await chunkIds(other.sourceId))[0]] }])).toBe(true);
    await runIngest(uid, sourceId, 2);
    expect(await summaryRow(sourceId)).toBeUndefined();
    expect(await summaryRow(other.sourceId)).toBeDefined();
  });

  it("펜싱에 걸리면(attempt 불일치) 요약을 지우지 않는다", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    expect(await save(jobId, [{ text: "요약", chunk_ids: [(await chunkIds(sourceId))[0]] }])).toBe(true);
    const job = await admin<{ id: string }>(
      `insert into public.processing_jobs (user_id, source_id, job_type, status, attempt_count, locked_until)
       values ($1, $2, 'source_ingest', 'running', 2, now() + interval '1 minute') returning id`,
      [uid, sourceId],
    );
    expect(await call<boolean>("select public.replace_source_chunks($1, 1, $2::jsonb) as r", [job.rows[0]!.id, chunksJson(1)])).toBe(false);
    expect(await summaryRow(sourceId)).toBeDefined();
  });
});

describe("source_summaries RLS", () => {
  const visible = (sub: string, sourceId: string) =>
    as(asUser(sub), async (c) => (await c.query("select source_id from public.source_summaries where source_id = $1", [sourceId])).rowCount);

  async function savedSummary() {
    const s = await completedSource();
    expect(await save(s.jobId, [{ text: "요약", chunk_ids: [(await chunkIds(s.sourceId))[0]] }])).toBe(true);
    return s;
  }

  it("소유자만 읽고, 자료가 비활성·삭제되면 숨긴다", async () => {
    const { uid, sourceId } = await savedSummary();
    const other = await createUser();
    expect(await visible(uid, sourceId)).toBe(1);
    expect(await visible(other, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = null, deleted_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
  });

  it("사용자는 쓸 수 없다(INSERT·UPDATE·DELETE 42501), anon은 읽을 수 없다", async () => {
    const { uid, sourceId, projectId, jobId } = await savedSummary();
    const writes = [
      [
        `insert into public.source_summaries (source_id, project_id, user_id, job_id, sentences, model)
         values ($1, $2, $3, $4, '[{"text":"t","chunk_ids":[]}]', 'm')`,
        [sourceId, projectId, uid, jobId],
      ],
      ["update public.source_summaries set model = 'x' where source_id = $1", [sourceId]],
      ["delete from public.source_summaries where source_id = $1", [sourceId]],
    ] as const;
    for (const [sql, params] of writes) expect((await failure(asUser(uid), sql, [...params]))?.code).toBe("42501");
    expect((await failure({ role: "anon" }, "select 1 from public.source_summaries"))?.code).toBe("42501");
  });

  it("자료를 영구 삭제하면 요약도 지워진다", async () => {
    const { sourceId } = await savedSummary();
    await admin("delete from public.sources where id = $1", [sourceId]);
    expect(await summaryRow(sourceId)).toBeUndefined();
  });
});
