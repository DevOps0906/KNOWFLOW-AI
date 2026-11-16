// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCaptureStore, isCaptureEnabled, purgeCaptures } from "./service";

const dir = fileURLToPath(new URL(".", import.meta.url));

/** capture_purge_queue·Storage remove만 흉내 내는 가짜 admin 클라이언트 */
function fakeAdmin(queue: string[], opts: { removeError?: boolean } = {}) {
  const removed: string[][] = [];
  const admin = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async (n: number) => ({ data: queue.slice(0, n).map((storage_path) => ({ storage_path })), error: null }),
        }),
      }),
      delete: () => ({
        in: async (_col: string, paths: string[]) => {
          for (const p of paths) queue.splice(queue.indexOf(p), 1);
          return { error: null };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          expect(bucket).toBe("captures");
          if (opts.removeError) return { data: null, error: { message: "boom" } };
          removed.push(paths);
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };
  return { admin: admin as unknown as SupabaseClient, removed };
}

describe("isCaptureEnabled", () => {
  it("CAPTURE_ENABLED=true일 때만 켜진다(YOUTUBE_ENABLED와 별개, 기본 꺼짐)", () => {
    expect(isCaptureEnabled({})).toBe(false);
    expect(isCaptureEnabled({ YOUTUBE_ENABLED: "true" })).toBe(false);
    expect(isCaptureEnabled({ CAPTURE_ENABLED: "1" })).toBe(false);
    expect(isCaptureEnabled({ CAPTURE_ENABLED: "true" })).toBe(true);
  });
});

describe("purgeCaptures (영상·자료 삭제 시 캡처 제거)", () => {
  it("대기열의 경로를 captures 버킷에서 지운 뒤 대기열에서 뺀다", async () => {
    const queue = ["u/s/a.webp", "u/s/b.jpg"];
    const { admin, removed } = fakeAdmin(queue);
    expect(await purgeCaptures(admin)).toBe(2);
    expect(removed).toEqual([["u/s/a.webp", "u/s/b.jpg"]]);
    expect(queue).toEqual([]);
  });

  it("객체 삭제가 실패하면 대기열을 남긴다(다음 처리에서 다시)", async () => {
    const queue = ["u/s/a.webp"];
    const { admin } = fakeAdmin(queue, { removeError: true });
    await expect(purgeCaptures(admin)).rejects.toThrow("purge_remove_failed");
    expect(queue).toEqual(["u/s/a.webp"]);
  });
});

describe("removeObject (확정 실패 뒤 직접 삭제)", () => {
  function fakeRemoveAdmin(opts: { removeError: boolean; rpcError?: boolean }) {
    const rpc = vi.fn(async () => ({ data: null, error: opts.rpcError ? { message: "x" } : null }));
    const admin = {
      rpc,
      storage: { from: () => ({ remove: async () => (opts.removeError ? { data: null, error: { message: "boom" } } : { data: [], error: null }) }) },
    };
    return { store: createCaptureStore(admin as unknown as SupabaseClient), rpc };
  }

  it("삭제가 성공하면 대기열에 넣지 않는다", async () => {
    const { store, rpc } = fakeRemoveAdmin({ removeError: false });
    await store.removeObject("u/s/a.webp");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Storage가 error를 돌려주면 경로를 대기열에 다시 넣는다(enqueue_capture_purge)", async () => {
    const { store, rpc } = fakeRemoveAdmin({ removeError: true });
    await store.removeObject("u/s/a.webp");
    expect(rpc).toHaveBeenCalledWith("enqueue_capture_purge", { p_storage_path: "u/s/a.webp" });
  });

  it("대기열 재삽입도 실패하면 오류를 던진다", async () => {
    const { store } = fakeRemoveAdmin({ removeError: true, rpcError: true });
    await expect(store.removeObject("u/s/a.webp")).rejects.toThrow("enqueue_purge_failed");
  });
});

describe("서버 경계", () => {
  it("src/server/captures 모듈은 server-only를 먼저 불러온다", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("캡처 화면 코드는 @/server를 값으로 불러오지 않는다", () => {
    const ui = join(dir, "..", "..", "components", "youtube", "capture");
    for (const f of readdirSync(ui).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))) {
      expect(readFileSync(join(ui, f), "utf8")).not.toMatch(/^import (?!type )[^;]*from "@\/server\//m);
    }
  });
});
