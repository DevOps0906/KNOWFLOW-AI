import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure } from "./db";

// 자료 다이제스트(docs/digest-contract.md §2·§2-1): source_digests RLS, save_source_digest 저장 조건.

const SERVICE = { role: "service_role" as const };
const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

async function insertSource(uid: string, projectId: string, type: "youtube" | "pdf" | "url" = "pdf") {
  if (type === "url") {
    const r = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, original_url) values ($1, $2, 'url', '웹', 'https://example.test/a') returning id`,
      [projectId, uid],
    );
    return r.rows[0]!.id;
  }
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, storage_path) values ($1, $2, 'pdf', '문서', $3) returning id`,
    [projectId, uid, `${uid}/${projectId}/${randomUUID()}.pdf`],
  );
  return r.rows[0]!.id;
}

const chunksJson = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ chunk_index: i, content: `본문 ${i}`, locator: { page: i + 1 } })));

const call = async <T>(sql: string, params: unknown[]) =>
  (await as(SERVICE, (c) => c.query<{ r: T }>(sql, params), { commit: true })).rows[0]!.r;

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

async function completedSource(type: "pdf" | "url" = "pdf") {
  const uid = await createUser();
  const projectId = await createProject(uid);
  const sourceId = await insertSource(uid, projectId, type);
  const jobId = await runIngest(uid, sourceId);
  return { uid, projectId, sourceId, jobId };
}

const chunkIds = async (sourceId: string) =>
  (await admin<{ id: string }>("select id from public.source_chunks where source_id = $1 order by chunk_index", [sourceId])).rows.map((r) => r.id);

/** 계약 §2 형식의 최소 유효 다이제스트 */
const digestOf = (a: string, b = a) => ({
  version: 1,
  title: "문서 다이제스트",
  glance: [
    { text: "첫 요점", details: ["세부"], chunk_ids: [a] },
    { text: "둘째 요점", details: [], chunk_ids: [b] },
  ],
  terms: [{ term: "용어", desc: "설명", chunk_ids: [a] }],
  chapters: [
    {
      title: "1장",
      intro: "도입",
      chunk_ids: [a],
      points: [{ text: "요점", chunk_ids: [b], subpoints: [{ text: "하위", chunk_ids: [a, b] }] }],
    },
  ],
});

const save = (jobId: string, status: string, digest: unknown, model = "stub-digest-v1") =>
  call<boolean>("select public.save_source_digest($1, $2, $3::jsonb, $4) as r", [
    jobId,
    status,
    digest === null ? null : JSON.stringify(digest),
    model,
  ]);

const digestRow = async (sourceId: string) =>
  (await admin<{ job_id: string; status: string; digest: unknown; model: string; user_id: string; project_id: string }>(
    "select job_id, status, digest, model, user_id, project_id from public.source_digests where source_id = $1",
    [sourceId],
  )).rows[0];

describe("save_source_digest", () => {
  it("최신 완료 작업·그 자료의 청크면 ready로 저장하고, failed(digest null)로 덮어쓸 수 있다", async () => {
    const { uid, projectId, sourceId, jobId } = await completedSource();
    const [a, b] = await chunkIds(sourceId);
    const d = digestOf(a!, b!);
    expect(await save(jobId, "ready", d)).toBe(true);
    expect(await digestRow(sourceId)).toEqual({ job_id: jobId, status: "ready", digest: d, model: "stub-digest-v1", user_id: uid, project_id: projectId });
    expect(await save(jobId, "failed", null, "m2")).toBe(true);
    expect(await digestRow(sourceId)).toMatchObject({ status: "failed", digest: null, model: "m2" });
  });

  it("다른 자료의 청크·없는 청크를 인용하면 false로 거부하고 기존 행을 건드리지 않는다", async () => {
    const { sourceId, jobId } = await completedSource();
    const other = await completedSource();
    const [a] = await chunkIds(sourceId);
    const [foreign] = await chunkIds(other.sourceId);
    expect(await save(jobId, "ready", digestOf(a!))).toBe(true);
    expect(await save(jobId, "ready", digestOf(a!, foreign!))).toBe(false);
    const deep = digestOf(a!);
    deep.chapters[0]!.points[0]!.subpoints[0]!.chunk_ids = [randomUUID()];
    expect(await save(jobId, "ready", deep)).toBe(false);
    expect((await digestRow(sourceId))?.digest).toEqual(digestOf(a!));
  });

  it("완료되지 않은 작업·낡은 작업·삭제·비활성 자료는 false(failed 저장도 같다)", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    const newer = await runIngest(uid, sourceId);
    const [c] = await chunkIds(sourceId);
    expect(await save(jobId, "ready", digestOf(c!))).toBe(false);
    expect(await save(jobId, "failed", null)).toBe(false);
    expect(await save(newer, "ready", digestOf(c!))).toBe(true);

    const r = await completedSource();
    await admin("update public.processing_jobs set status = 'running', progress = 0 where id = $1", [r.jobId]);
    expect(await save(r.jobId, "failed", null)).toBe(false);
    const d = await completedSource();
    await admin("update public.sources set deleted_at = now() where id = $1", [d.sourceId]);
    expect(await save(d.jobId, "failed", null)).toBe(false);
    const u = await completedSource();
    await admin("update public.sources set unavailable_at = now() where id = $1", [u.sourceId]);
    expect(await save(u.jobId, "failed", null)).toBe(false);
    expect(await save(randomUUID(), "failed", null)).toBe(false);
  });

  it("형식 오류·개수·길이·256KB 초과·모델명·상태 오류·url 자료는 22023", async () => {
    const { sourceId, jobId } = await completedSource();
    const [a] = await chunkIds(sourceId);
    const ok = digestOf(a!);
    const ch = ok.chapters[0]!;
    const bad: unknown[] = [
      [],
      { ...ok, version: 2 },
      { ...ok, title: " " },
      { ...ok, title: "가".repeat(121) },
      { ...ok, glance: [ok.glance[0]] },
      { ...ok, glance: Array.from({ length: 6 }, () => ok.glance[0]) },
      { ...ok, glance: [{ ...ok.glance[0], details: ["1", "2", "3", "4"] }, ok.glance[1]] },
      { ...ok, glance: [{ ...ok.glance[0], text: "가".repeat(301) }, ok.glance[1]] },
      { ...ok, glance: [{ text: "x", details: [] }, ok.glance[1]] },
      { ...ok, terms: Array.from({ length: 7 }, () => ok.terms[0]) },
      { ...ok, terms: [{ ...ok.terms[0], term: "가".repeat(41) }] },
      { ...ok, terms: [{ ...ok.terms[0], desc: "가".repeat(201) }] },
      { ...ok, chapters: [] },
      { ...ok, chapters: [{ ...ch, points: [] }] },
      { ...ok, chapters: [{ ...ch, intro: "가".repeat(401) }] },
      { ...ok, chapters: [{ ...ch, chunk_ids: [] }] },
      { ...ok, chapters: [{ ...ch, points: [{ ...ch.points[0], chunk_ids: [a!.toUpperCase()] }] }] },
      { ...ok, chapters: [{ ...ch, points: [{ ...ch.points[0], subpoints: [{ text: "s" }] }] }] },
      { ...ok, title: "x", pad: "가".repeat(90_000) },
    ];
    for (const b of bad) await expect(save(jobId, "ready", b)).rejects.toMatchObject({ code: "22023" });
    await expect(save(jobId, "ready", null)).rejects.toMatchObject({ code: "22023" });
    await expect(save(jobId, "failed", ok)).rejects.toMatchObject({ code: "22023" });
    await expect(save(jobId, "pending", null)).rejects.toMatchObject({ code: "22023" });
    await expect(save(jobId, "ready", ok, " ")).rejects.toMatchObject({ code: "22023" });
    expect(await digestRow(sourceId)).toBeUndefined();

    const url = await completedSource("url");
    await expect(save(url.jobId, "failed", null)).rejects.toMatchObject({ code: "22023" });
  });

  it("service_role 전용: anon·authenticated는 42501", async () => {
    const { uid, jobId } = await completedSource();
    for (const actor of [{ role: "anon" as const }, asUser(uid)]) {
      const f = await failure(actor, "select public.save_source_digest($1, 'failed', null, 'm')", [jobId]);
      expect(f?.code).toBe("42501");
    }
  });

  it("청크를 교체해도 행은 남고(job_id로 오래됨 판정), 자료를 영구 삭제하면 지워진다", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    expect(await save(jobId, "ready", digestOf((await chunkIds(sourceId))[0]!))).toBe(true);
    await runIngest(uid, sourceId, 2);
    expect((await digestRow(sourceId))?.job_id).toBe(jobId);
    await admin("delete from public.sources where id = $1", [sourceId]);
    expect(await digestRow(sourceId)).toBeUndefined();
  });
});

describe("source_digests RLS", () => {
  const visible = (sub: string, sourceId: string) =>
    as(asUser(sub), async (c) => (await c.query("select source_id from public.source_digests where source_id = $1", [sourceId])).rowCount);

  it("소유자만 읽고, 자료가 비활성·삭제되면 숨긴다", async () => {
    const { uid, sourceId, jobId } = await completedSource();
    expect(await save(jobId, "failed", null)).toBe(true);
    const other = await createUser();
    expect(await visible(uid, sourceId)).toBe(1);
    expect(await visible(other, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
    await admin("update public.sources set unavailable_at = null, deleted_at = now() where id = $1", [sourceId]);
    expect(await visible(uid, sourceId)).toBe(0);
  });

  it("사용자는 쓸 수 없다(INSERT·UPDATE·DELETE 42501), anon은 읽을 수 없다", async () => {
    const { uid, sourceId, projectId, jobId } = await completedSource();
    expect(await save(jobId, "failed", null)).toBe(true);
    const writes = [
      [
        `insert into public.source_digests (source_id, project_id, user_id, job_id, status, digest, model)
         values ($1, $2, $3, $4, 'failed', null, 'm')`,
        [sourceId, projectId, uid, jobId],
      ],
      ["update public.source_digests set model = 'x' where source_id = $1", [sourceId]],
      ["delete from public.source_digests where source_id = $1", [sourceId]],
    ] as const;
    for (const [sql, params] of writes) expect((await failure(asUser(uid), sql, [...params]))?.code).toBe("42501");
    expect((await failure({ role: "anon" }, "select 1 from public.source_digests"))?.code).toBe("42501");
  });
});
