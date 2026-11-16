import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { sanitize, type LogFields } from "../log.js";
import {
  CaptureRemoveError,
  createPgCaptureTrashStore,
  createSupabaseStorageRemover,
  runCaptureCleanup,
  type CaptureObjectRemover,
  type CaptureTrashStore,
} from "./cleanup.js";

// task-030: L1 캡처 객체 정리(claim → Storage 삭제 → ack, 실패 시 ack 안 함)

const P1 = "01010101-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/a.png";
const P2 = "01010101-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/b.webp";
const KEY = "service-role-KEY-123";

function fakeStore(batches: string[][]) {
  const queue = [...batches];
  const store: CaptureTrashStore & { claim: ReturnType<typeof vi.fn>; ack: ReturnType<typeof vi.fn> } = {
    claim: vi.fn(async () => queue.shift() ?? []),
    ack: vi.fn(async (paths: string[]) => paths.length),
  };
  return store;
}

describe("runCaptureCleanup", () => {
  it("맡은 경로를 Storage에서 지운 뒤 같은 경로를 ack한다", async () => {
    const store = fakeStore([[P1, P2]]);
    const remover: CaptureObjectRemover = { remove: vi.fn(async () => {}) };
    const logs: LogFields[] = [];
    await runCaptureCleanup(store, remover, (f) => void logs.push(f), 100);
    expect(store.claim).toHaveBeenCalledWith(100);
    expect(remover.remove).toHaveBeenCalledWith([P1, P2]);
    expect(store.ack).toHaveBeenCalledWith([P1, P2]);
    expect(sanitize(logs[0]!)).toEqual({ event: "capture_cleanup", outcome: "done", claimed: 2, cleaned: 2 });
  });

  it("Storage 삭제가 실패하면 ack하지 않고(경로는 claim 재배정으로 다시) 로그에 경로를 남기지 않는다", async () => {
    const store = fakeStore([[P1, P2]]);
    const remover: CaptureObjectRemover = { remove: vi.fn(async () => Promise.reject(new CaptureRemoveError("http_500"))) };
    const logs: LogFields[] = [];
    await runCaptureCleanup(store, remover, (f) => void logs.push(f), 100);
    expect(store.ack).not.toHaveBeenCalled();
    expect(sanitize(logs[0]!)).toEqual({ event: "capture_cleanup", outcome: "failed", claimed: 2, cleaned: 0, reason: "http_500", errorName: "CaptureRemoveError" });
    expect(JSON.stringify(logs)).not.toContain("01010101");
  });

  it("빈 대기열이면 Storage를 부르지 않고, 꽉 찬 배치는 다음 배치를 이어서 맡는다(상한까지)", async () => {
    const empty = fakeStore([]);
    const remover: CaptureObjectRemover = { remove: vi.fn(async () => {}) };
    await runCaptureCleanup(empty, remover, () => {}, 2);
    expect(remover.remove).not.toHaveBeenCalled();
    expect(empty.ack).not.toHaveBeenCalled();

    const full = fakeStore([[P1, P2], [P1, P2], [P1]]);
    await runCaptureCleanup(full, remover, () => {}, 2, 2);
    expect(full.claim).toHaveBeenCalledTimes(2);
    expect(full.ack).toHaveBeenCalledTimes(2);
  });

  it("claim·ack DB 오류도 Worker를 멈추지 않고 failed 로그만 남긴다", async () => {
    const store = { claim: async () => Promise.reject(new Error("db down")), ack: vi.fn() };
    const logs: LogFields[] = [];
    await runCaptureCleanup(store, { remove: vi.fn() }, (f) => void logs.push(f));
    expect(logs[0]).toMatchObject({ event: "capture_cleanup", outcome: "failed", errorName: "Error" });
    expect(store.ack).not.toHaveBeenCalled();
  });
});

describe("Supabase Storage 삭제", () => {
  it("DELETE /storage/v1/object/knowflow-captures에 prefixes로 보내고 키는 헤더로만 보낸다", async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response("[]", { status: 200 }));
    const remover = createSupabaseStorageRemover({ url: "https://abc.supabase.co", serviceRoleKey: KEY, fetch: fetchMock as unknown as typeof fetch });
    await remover.remove([P1, P2]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://abc.supabase.co/storage/v1/object/knowflow-captures");
    expect(String(url)).not.toContain(KEY);
    expect(init!.method).toBe("DELETE");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init!.body))).toEqual({ prefixes: [P1, P2] });
  });

  it("2xx가 아니거나 네트워크 오류면 고정 코드로 throw(본문·키 없음)", async () => {
    const status = (s: number) => async () => new Response("secret body", { status: s });
    for (const [f, code] of [
      [status(500), "http_500"],
      [status(401), "http_401"],
      [async () => Promise.reject(new TypeError("fetch failed")), "network_error"],
    ] as const) {
      const remover = createSupabaseStorageRemover({ url: "https://abc.supabase.co", serviceRoleKey: KEY, fetch: f as unknown as typeof fetch });
      const e = await remover.remove([P1]).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(CaptureRemoveError);
      expect((e as CaptureRemoveError).code).toBe(code);
      expect((e as Error).message).not.toContain(KEY);
    }
  });
});

describe("정리 저장소(pg)", () => {
  it("claim·ack는 service_role RPC를 부른다", async () => {
    const sql: string[] = [];
    const pool = {
      query: vi.fn(async (text: string, params: unknown[]) => {
        sql.push(text);
        return { rows: [text.includes("claim_") ? { paths: [P1] } : { n: (params[0] as string[]).length }] };
      }),
    };
    const store = createPgCaptureTrashStore(pool as never);
    expect(await store.claim(50)).toEqual([P1]);
    expect(await store.ack([P1])).toBe(1);
    expect(sql[0]).toContain("nomad_knowflow.claim_capture_object_trash($1)");
    expect(sql[1]).toContain("nomad_knowflow.ack_capture_object_trash($1::text[])");
  });
});

describe("설정", () => {
  const REMOTE = "postgres://u:p@db.abc.supabase.co:5432/k";
  const LOCAL = "postgres://u:p@localhost:5432/k";
  it("둘 다 없으면 정리 꺼짐, 하나만 있으면 기동 거부", () => {
    expect(loadConfig({ DATABASE_URL: REMOTE }).captureStorage).toBeNull();
    expect(() => loadConfig({ DATABASE_URL: REMOTE, SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/함께/);
    expect(() => loadConfig({ DATABASE_URL: REMOTE, SUPABASE_SERVICE_ROLE_KEY: KEY })).toThrow(/함께/);
  });

  it("https origin만(운영), http는 로컬 DB일 때만. 오류 메시지에 키가 없다", () => {
    expect(loadConfig({ DATABASE_URL: REMOTE, SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: KEY }).captureStorage).toEqual({
      url: "https://abc.supabase.co",
      serviceRoleKey: KEY,
    });
    expect(loadConfig({ DATABASE_URL: LOCAL, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: KEY }).captureStorage?.url).toBe(
      "http://127.0.0.1:54321",
    );
    for (const url of ["http://abc.supabase.co", "https://abc.supabase.co/x", "https://u:p@abc.supabase.co", "nope"]) {
      expect(() => loadConfig({ DATABASE_URL: REMOTE, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: KEY })).toThrow(/SUPABASE_URL/);
    }
    try {
      loadConfig({ DATABASE_URL: REMOTE, SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "bad key" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect((e as Error).message).not.toContain("bad key");
    }
  });
});
