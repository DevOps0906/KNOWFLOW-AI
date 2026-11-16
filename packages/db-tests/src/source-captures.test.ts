import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, as, connect, createProject, createUser, failure, setActor } from "./db";

// task-030: source_captures(RLS) · captures 버킷 · reserve/confirm/discard_capture · 삭제 대기열 트리거.

const SERVICE = { role: "service_role" as const };

let seq = 0;
const newVideoId = () => `cap${String(++seq).padStart(4, "0")}${randomUUID().slice(0, 4)}`;

async function youtubeSource(opts: { uid?: string } = {}) {
  const uid = opts.uid ?? (await createUser());
  const projectId = await createProject(uid);
  const videoId = newVideoId();
  const r = await admin<{ id: string }>(
    `insert into public.sources (project_id, user_id, source_type, title, original_url, video_id, status)
     values ($1, $2, 'youtube', '영상', $3, $4, 'completed') returning id`,
    [projectId, uid, `https://www.youtube.com/watch?v=${videoId}`, videoId],
  );
  const sourceId = r.rows[0]!.id;
  const m = await admin<{ id: string }>(
    `insert into public.source_moments (source_id, project_id, user_id, moment_index, locator, title, description)
     values ($1, $2, $3, 0, '{"t_start":5,"t_end":20}', '장면', '설명') returning id`,
    [sourceId, projectId, uid],
  );
  return { uid, projectId, sourceId, videoId, momentId: m.rows[0]!.id };
}

interface Reserved {
  capture_id: string;
  storage_path: string;
  status: string;
  duplicate: boolean;
}

const reserve = async (sourceId: string, uid: string, key: string, opts: { momentId?: string | null; mime?: string } = {}) =>
  (
    await as(
      SERVICE,
      (c) =>
        c.query<{ r: Reserved }>("select public.reserve_capture($1, $2, $3, $4, $5, $6) as r", [
          sourceId,
          uid,
          12.5,
          opts.momentId ?? null,
          key,
          opts.mime ?? "image/webp",
        ]),
      { commit: true },
    )
  ).rows[0]!.r;

const confirm = async (captureId: string, uid: string) =>
  (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.confirm_capture($1, $2, 1000) as ok", [captureId, uid]), { commit: true }))
    .rows[0]!.ok;

const reserveFailure = (sourceId: string, uid: string, key: string, mime = "image/webp") =>
  failure(SERVICE, "select public.reserve_capture($1, $2, 1, null, $3, $4)", [sourceId, uid, key, mime]);

const captureCount = async (sourceId: string) =>
  (await admin<{ n: number }>("select count(*)::int as n from public.source_captures where source_id = $1", [sourceId])).rows[0]!.n;

const queued = async (path: string) =>
  (await admin<{ reason: string }>("select reason from public.capture_purge_queue where storage_path = $1", [path])).rows[0]?.reason ?? null;

describe("captures 버킷", () => {
  it("비공개·2MB·WebP/JPEG이고 storage.objects 정책이 없다", async () => {
    const b = await admin("select public, file_size_limit::text as limit, allowed_mime_types from storage.buckets where id = 'captures'");
    expect(b.rows[0]).toEqual({ public: false, limit: "2097152", allowed_mime_types: ["image/webp", "image/jpeg"] });
    const policies = await admin(
      "select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%captures%' or with_check like '%captures%')",
    );
    expect(policies.rows).toEqual([]);
  });
});

describe("reserve_capture · confirm_capture", () => {
  it("경로를 정하고 pending으로 잡은 뒤 confirm으로 ready가 된다. 같은 멱등 키는 같은 행을 돌려준다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "key-1", { momentId: s.momentId });
    expect(r.duplicate).toBe(false);
    expect(r.status).toBe("pending");
    expect(r.storage_path).toBe(`${s.uid}/${s.sourceId}/${r.capture_id}.webp`);
    expect(await confirm(r.capture_id, s.uid)).toBe(true);

    const again = await reserve(s.sourceId, s.uid, "key-1", { momentId: s.momentId });
    expect(again).toEqual({ ...r, status: "ready", duplicate: true });
    expect(await captureCount(s.sourceId)).toBe(1);

    // 같은 키를 다른 형식으로 재사용하면 KF409
    expect((await reserveFailure(s.sourceId, s.uid, "key-1", "image/jpeg"))?.code).toBe("KF409");
  });

  it("자료당 20장: 21장째는 KF429", async () => {
    const s = await youtubeSource();
    for (let i = 0; i < 20; i++) await reserve(s.sourceId, s.uid, `k${i}`);
    expect((await reserveFailure(s.sourceId, s.uid, "k20"))?.code).toBe("KF429");
    expect(await captureCount(s.sourceId)).toBe(20);
  });

  it("타인 자료·삭제·비활성 자료는 P0002, 유튜브 외 자료는 KF422, 잘못된 입력은 22023", async () => {
    const s = await youtubeSource();
    const other = await createUser();
    expect((await reserveFailure(s.sourceId, other, "k"))?.code).toBe("P0002");
    expect((await reserveFailure(s.sourceId, s.uid, "k", "image/png"))?.code).toBe("22023");
    expect((await reserveFailure(s.sourceId, s.uid, "bad key"))?.code).toBe("22023");
    // 다른 자료의 장면 id
    const t = await youtubeSource();
    expect((await failure(SERVICE, "select public.reserve_capture($1, $2, 1, $3, 'k', 'image/webp')", [s.sourceId, s.uid, t.momentId]))?.code).toBe(
      "22023",
    );

    const pdf = await admin<{ id: string }>(
      `insert into public.sources (project_id, user_id, source_type, title, storage_path)
       values ($1, $2, 'pdf', '문서', $3) returning id`,
      [s.projectId, s.uid, `${s.uid}/${randomUUID()}.pdf`],
    );
    expect((await reserveFailure(pdf.rows[0]!.id, s.uid, "k"))?.code).toBe("KF422");

    await admin("update public.sources set unavailable_at = now() where id = $1", [t.sourceId]);
    expect((await reserveFailure(t.sourceId, t.uid, "k"))?.code).toBe("P0002");
  });

  it("authenticated는 캡처 RPC를 실행할 수 없다", async () => {
    const s = await youtubeSource();
    const actor = { role: "authenticated" as const, sub: s.uid };
    expect((await failure(actor, "select public.reserve_capture($1, $2, 1, null, 'k', 'image/webp')", [s.sourceId, s.uid]))?.code).toBe("42501");
    expect((await failure(actor, "select public.confirm_capture($1, $2, 1)", [randomUUID(), s.uid]))?.code).toBe("42501");
    expect((await failure(actor, "select public.discard_capture($1, $2, 'user_deleted')", [randomUUID(), s.uid]))?.code).toBe("42501");
    expect((await failure(actor, "select public.enqueue_capture_purge($1)", [`${s.uid}/${s.sourceId}/${randomUUID()}.webp`]))?.code).toBe("42501");
  });

  it("10분 지난 pending 행은 다음 reserve 때 대기열(pending_expired)로 옮겨지고 한도에서 빠진다", async () => {
    const s = await youtubeSource();
    for (let i = 0; i < 20; i++) await reserve(s.sourceId, s.uid, `k${i}`);
    const old = await admin<{ storage_path: string }>(
      "update public.source_captures set created_at = now() - interval '11 minutes' where source_id = $1 and idempotency_key = 'k0' returning storage_path",
      [s.sourceId],
    );
    const r = await reserve(s.sourceId, s.uid, "k20");
    expect(r.duplicate).toBe(false);
    expect(await captureCount(s.sourceId)).toBe(20);
    expect(await queued(old.rows[0]!.storage_path)).toBe("pending_expired");
    // ready 행은 오래돼도 남는다
    await confirm(r.capture_id, s.uid);
    await admin("update public.source_captures set created_at = now() - interval '1 day' where id = $1", [r.capture_id]);
    await reserve(s.sourceId, s.uid, "k21").catch(() => {});
    expect((await admin("select 1 from public.source_captures where id = $1", [r.capture_id])).rowCount).toBe(1);
  });

  it("프로젝트 삭제가 진행 중이면 reserve는 기다렸다가 P0002(캡처 행이 남지 않는다)", async () => {
    const s = await youtubeSource();
    const deleter = await connect();
    try {
      await deleter.query("begin");
      await setActor(deleter, { role: "authenticated", sub: s.uid });
      await deleter.query("select public.delete_project($1)", [s.projectId]);
      const pending = reserveFailure(s.sourceId, s.uid, "race");
      await new Promise((r) => setTimeout(r, 300));
      await deleter.query("commit");
      expect((await pending)?.code).toBe("P0002");
    } finally {
      await deleter.end();
    }
    expect(await captureCount(s.sourceId)).toBe(0);
  });

  it("프로젝트가 삭제된 뒤에는 confirm이 false", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    // 트리거를 거치지 않은 상태를 흉내: 행을 남긴 채 프로젝트만 삭제 표시
    await admin("alter table public.projects disable trigger projects_capture_purge_after_update");
    try {
      await admin("update public.projects set deleted_at = now() where id = $1", [s.projectId]);
    } finally {
      await admin("alter table public.projects enable trigger projects_capture_purge_after_update");
    }
    expect(await confirm(r.capture_id, s.uid)).toBe(false);
  });
});

describe("source_captures RLS", () => {
  it("소유자만 본다. 타인은 0건이고 쓰기 권한이 없다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    await confirm(r.capture_id, s.uid);
    const mine = await as({ role: "authenticated", sub: s.uid }, (c) => c.query("select id from public.source_captures where source_id = $1", [s.sourceId]));
    expect(mine.rows).toEqual([{ id: r.capture_id }]);

    const other = await createUser();
    const theirs = await as({ role: "authenticated", sub: other }, (c) => c.query("select id from public.source_captures where source_id = $1", [s.sourceId]));
    expect(theirs.rows).toEqual([]);
    expect((await failure({ role: "authenticated", sub: s.uid }, "delete from public.source_captures where id = $1", [r.capture_id]))?.code).toBe("42501");
    expect((await failure({ role: "authenticated", sub: other }, "select * from public.capture_purge_queue"))?.code).toBe("42501");
  });
});

describe("삭제 대기열 트리거", () => {
  it("소프트 삭제(delete_sources) 시 캡처 행이 지워지고 경로가 대기열에 들어간다. 복구해도 돌아오지 않는다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    await confirm(r.capture_id, s.uid);
    await as({ role: "authenticated", sub: s.uid }, (c) => c.query("select public.delete_sources($1, $2)", [s.projectId, [s.sourceId]]), { commit: true });
    expect(await captureCount(s.sourceId)).toBe(0);
    expect(await queued(r.storage_path)).toBe("source_deleted");
    await admin("update public.sources set deleted_at = null where id = $1", [s.sourceId]);
    expect(await captureCount(s.sourceId)).toBe(0);
  });

  it("비활성(takedown_video) 시 대기열로 옮긴다. 다른 자료 캡처는 그대로", async () => {
    const s = await youtubeSource();
    const keep = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    const k = await reserve(keep.sourceId, keep.uid, "k");
    await as(SERVICE, (c) => c.query("select public.takedown_video($1, 'RT-test')", [s.videoId]), { commit: true });
    expect(await captureCount(s.sourceId)).toBe(0);
    expect(await queued(r.storage_path)).toBe("source_unavailable");
    expect(await captureCount(keep.sourceId)).toBe(1);
    expect(await queued(k.storage_path)).toBeNull();
  });

  it("행 삭제(프로젝트 cascade 포함) 시 대기열로 옮긴다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    await admin("delete from public.projects where id = $1", [s.projectId]);
    expect(await queued(r.storage_path)).toBe("source_deleted");
  });

  it("프로젝트 소프트 삭제(delete_project) 시 그 프로젝트 모든 자료의 캡처를 대기열로 옮긴다. 다른 프로젝트는 그대로", async () => {
    const s = await youtubeSource();
    const keep = await youtubeSource({ uid: s.uid });
    const r = await reserve(s.sourceId, s.uid, "k");
    await confirm(r.capture_id, s.uid);
    const k = await reserve(keep.sourceId, keep.uid, "k");
    await as({ role: "authenticated", sub: s.uid }, (c) => c.query("select public.delete_project($1)", [s.projectId]), { commit: true });
    expect(await captureCount(s.sourceId)).toBe(0);
    expect(await queued(r.storage_path)).toBe("project_deleted");
    expect(await captureCount(keep.sourceId)).toBe(1);
    expect(await queued(k.storage_path)).toBeNull();
    await admin("update public.projects set deleted_at = null where id = $1", [s.projectId]);
    expect(await captureCount(s.sourceId)).toBe(0);
  });

  it("confirm 전에 자료가 삭제되면 confirm은 false", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    await admin("update public.sources set deleted_at = now() where id = $1", [s.sourceId]);
    expect(await confirm(r.capture_id, s.uid)).toBe(false);
  });

  it("장면 재처리로 카드가 지워져도 캡처는 남고 moment_id만 비운다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k", { momentId: s.momentId });
    await admin("delete from public.source_moments where id = $1", [s.momentId]);
    const row = await admin("select moment_id from public.source_captures where id = $1", [r.capture_id]);
    expect(row.rows).toEqual([{ moment_id: null }]);
  });

  it("discard_capture는 본인 행만 지우고 경로를 대기열에 넣는다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    const other = await createUser();
    const discard = async (uid: string) =>
      (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.discard_capture($1, $2, 'user_deleted') as ok", [r.capture_id, uid]), { commit: true }))
        .rows[0]!.ok;
    expect(await discard(other)).toBe(false);
    expect(await discard(s.uid)).toBe(true);
    expect(await queued(r.storage_path)).toBe("user_deleted");
  });

  it("discard_capture(upload_failed)는 pending만 지운다. 같은 키의 다른 요청이 확정한 ready 행은 남는다", async () => {
    const s = await youtubeSource();
    const r = await reserve(s.sourceId, s.uid, "k");
    await confirm(r.capture_id, s.uid);
    const discard = async (reason: string) =>
      (await as(SERVICE, (c) => c.query<{ ok: boolean }>("select public.discard_capture($1, $2, $3) as ok", [r.capture_id, s.uid, reason]), { commit: true }))
        .rows[0]!.ok;
    expect(await discard("upload_failed")).toBe(false);
    expect(await captureCount(s.sourceId)).toBe(1);
    expect(await queued(r.storage_path)).toBeNull();
    expect(await discard("user_deleted")).toBe(true);
  });

  it("enqueue_capture_purge는 형식이 맞는 경로만 대기열에 넣는다", async () => {
    const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}.jpg`;
    await as(SERVICE, (c) => c.query("select public.enqueue_capture_purge($1)", [path]), { commit: true });
    expect(await queued(path)).toBe("upload_failed");
    expect((await failure(SERVICE, "select public.enqueue_capture_purge($1)", ["../etc/passwd"]))?.code).toBe("22023");
  });
});
