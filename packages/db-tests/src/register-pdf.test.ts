import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, createProject, createUser, failure, sha256Hex } from "./db";

const asUser = (sub: string) => ({ role: "authenticated" as const, sub });

async function putObject(uid: string, projectId: string, meta: Record<string, unknown> = { size: 1000, mimetype: "application/pdf" }) {
  const path = `${uid}/${projectId}/${randomUUID()}.pdf`;
  await admin("insert into storage.objects (bucket_id, name, owner, metadata) values ('sources', $1, $2, $3)", [
    path,
    uid,
    JSON.stringify(meta),
  ]);
  return path;
}

const SQL = "select public.register_pdf_source($1, $2, $3, $4, $5, $6) as r";

async function register(
  sub: string,
  args: { projectId: string; title?: string; path: string; hash?: string | null; key?: string; request?: string },
) {
  const r = await as(
    asUser(sub),
    (c) =>
      c.query<{ r: { source_id: string; job_id: string; duplicate: boolean } }>(SQL, [
        args.projectId,
        args.title ?? "문서",
        args.path,
        args.hash === undefined ? sha256Hex(1) : args.hash,
        args.key ?? randomUUID(),
        args.request ?? "req-1",
      ]),
    { commit: true },
  );
  return r.rows[0]!.r;
}

const fail = (sub: string, args: Parameters<typeof register>[1]) =>
  failure(asUser(sub), SQL, [
    args.projectId,
    args.title ?? "문서",
    args.path,
    args.hash === undefined ? sha256Hex(1) : args.hash,
    args.key ?? randomUUID(),
    args.request ?? "req-1",
  ]);

describe("register_pdf_source", () => {
  it("올라간 PDF를 queued 자료와 작업으로 등록한다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = await putObject(uid, projectId);
    const result = await register(uid, { projectId, path, title: "  보고서  " });
    expect(result.duplicate).toBe(false);
    const row = await admin<{ title: string; status: string; storage_path: string; job_status: string }>(
      `select s.title, s.status, s.storage_path, j.status as job_status
         from public.sources s join public.processing_jobs j on j.source_id = s.id where s.id = $1`,
      [result.source_id],
    );
    expect(row.rows[0]).toEqual({ title: "보고서", status: "queued", storage_path: path, job_status: "queued" });
  });

  it("Storage에 없는 경로는 422(22023)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = `${uid}/${projectId}/${randomUUID()}.pdf`;
    expect((await fail(uid, { projectId, path }))?.code).toBe("22023");
  });

  it("50MB 초과는 KF413, 크기 0은 22023, PDF가 아닌 MIME은 KF415", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const big = await putObject(uid, projectId, { size: 52428801, mimetype: "application/pdf" });
    const empty = await putObject(uid, projectId, { size: 0, mimetype: "application/pdf" });
    const text = await putObject(uid, projectId, { size: 10, mimetype: "text/plain" });
    expect((await fail(uid, { projectId, path: big }))?.code).toBe("KF413");
    expect((await fail(uid, { projectId, path: empty }))?.code).toBe("22023");
    expect((await fail(uid, { projectId, path: text }))?.code).toBe("KF415");
  });

  it("경로 조작·타인 폴더·다른 프로젝트 폴더는 거부한다", async () => {
    const a = await createUser();
    const b = await createUser();
    const projectA = await createProject(a);
    const projectA2 = await createProject(a);
    const bPath = await putObject(b, await createProject(b));
    const wrongProject = await putObject(a, projectA2);
    for (const path of [
      bPath,
      wrongProject,
      `${a}/${projectA}/../../${b}/x.pdf`,
      `${a}/${projectA}/${randomUUID()}.pdf/../x.pdf`,
      `${a}/${projectA}/not-a-uuid.pdf`,
    ]) {
      expect((await fail(a, { projectId: projectA, path }))?.code).toBe("22023");
    }
  });

  it("타인 프로젝트에는 등록할 수 없고(P0002) 자료도 생기지 않는다", async () => {
    const a = await createUser();
    const b = await createUser();
    const projectB = await createProject(b);
    const path = await putObject(a, projectB); // 경로는 A의 폴더지만 프로젝트는 B의 것
    expect((await fail(a, { projectId: projectB, path }))?.code).toBe("P0002");
    const n = await admin<{ n: number }>("select count(*)::int as n from public.sources where project_id = $1", [projectB]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it("같은 멱등 키·같은 입력은 중복 등록 없이 같은 자료를 돌려준다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = await putObject(uid, projectId);
    const key = randomUUID();
    const first = await register(uid, { projectId, path, key });
    const again = await register(uid, { projectId, path, key });
    expect(again.duplicate).toBe(true);
    expect(again.source_id).toBe(first.source_id);
    const n = await admin<{ n: number }>("select count(*)::int as n from public.sources where project_id = $1", [projectId]);
    expect(n.rows[0]!.n).toBe(1);
  });

  it("같은 멱등 키에 다른 입력이면 KF409", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = await putObject(uid, projectId);
    const key = randomUUID();
    await register(uid, { projectId, path, key, request: "req-A" });
    expect((await fail(uid, { projectId, path, key, request: "req-B" }))?.code).toBe("KF409");
  });

  it("같은 프로젝트에 같은 content_hash를 다른 키로 올리면 KF409, 다른 프로젝트는 허용", async () => {
    const uid = await createUser();
    const p1 = await createProject(uid);
    const p2 = await createProject(uid);
    await register(uid, { projectId: p1, path: await putObject(uid, p1), hash: sha256Hex(7) });
    expect((await fail(uid, { projectId: p1, path: await putObject(uid, p1), hash: sha256Hex(7) }))?.code).toBe("KF409");
    await expect(register(uid, { projectId: p2, path: await putObject(uid, p2), hash: sha256Hex(7) })).resolves.toBeTruthy();
  });

  it("동시에 같은 멱등 키로 요청해도 자료는 하나다", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const path = await putObject(uid, projectId);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => register(uid, { projectId, path, key })));
    expect(new Set(results.map((r) => r.source_id)).size).toBe(1);
    const n = await admin<{ n: number }>("select count(*)::int as n from public.sources where project_id = $1", [projectId]);
    expect(n.rows[0]!.n).toBe(1);
  });

  it("미인증은 28000, anon은 실행 권한 없음(42501)", async () => {
    const uid = await createUser();
    const projectId = await createProject(uid);
    const args = [projectId, "t", `${uid}/${projectId}/${randomUUID()}.pdf`, null, "k", "r"];
    expect((await failure({ role: "authenticated" }, SQL, args))?.code).toBe("28000");
    expect((await failure({ role: "anon" }, SQL, args))?.code).toBe("42501");
  });
});

describe("Storage 객체 접근", () => {
  it("다른 사용자의 객체는 조회·업로드할 수 없다", async () => {
    const a = await createUser();
    const b = await createUser();
    const path = await putObject(a, await createProject(a));
    const seen = await as(asUser(b), (c) => c.query("select name from storage.objects where name = $1", [path]));
    expect(seen.rowCount).toBe(0);
    const denied = await failure(asUser(b), "insert into storage.objects (bucket_id, name) values ('sources', $1)", [
      `${a}/x/${randomUUID()}.pdf`,
    ]);
    expect(denied?.code).toBe("42501");
  });
});
