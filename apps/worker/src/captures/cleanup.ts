// L1 캡처 객체 정리(task-030, ADR-0006): 지운 캡처 행의 Storage 객체를 주기적으로 지운다.
// 순서: claim_capture_object_trash(경로를 맡음) → Storage에서 삭제 → ack_capture_object_trash(대기열에서 뺌).
// Storage 삭제가 실패하면 ack하지 않는다. 맡은 경로는 15분 뒤 DB가 다시 배정하므로 경로를 잃지 않는다.
// 경로·키는 로그에 남기지 않는다(숫자와 결과만). 서버는 영상을 내려받지 않는다(이미지 객체 삭제만).
import type { Pool } from "pg";
import type { Logger } from "../log.js";

export const CAPTURE_CLEANUP_SETTINGS = {
  bucket: "knowflow-captures",
  /** 정리 주기(기동 직후 1회 + 이후 이 간격). claim은 15분 지나면 재배정되므로 그보다 짧게 */
  intervalMs: 10 * 60 * 1000,
  /** 한 번에 맡는 경로 수(claim_capture_object_trash 1~1000) */
  batchLimit: 100,
  /** 한 주기에 도는 최대 배치 수(밀린 대기열을 나눠 비운다) */
  maxBatchesPerRun: 10,
  requestTimeoutMs: 15_000,
} as const;

export interface CaptureTrashStore {
  /** 정리할 경로를 맡는다(service_role). 없으면 빈 배열 */
  claim(limit: number): Promise<string[]>;
  /** Storage에서 지운 경로를 대기열에서 뺀다. 반환: 뺀 행 수 */
  ack(paths: string[]): Promise<number>;
}

export interface CaptureObjectRemover {
  /** 경로들을 지운다. 이미 없는 객체는 성공으로 본다. 실패하면 throw(호출자는 ack하지 않는다) */
  remove(paths: string[]): Promise<void>;
}

export function createPgCaptureTrashStore(pool: Pick<Pool, "query">): CaptureTrashStore {
  return {
    async claim(limit) {
      const r = await pool.query<{ paths: string[] }>("select nomad_knowflow.claim_capture_object_trash($1) as paths", [limit]);
      return r.rows[0]?.paths ?? [];
    },
    async ack(paths) {
      const r = await pool.query<{ n: number }>("select nomad_knowflow.ack_capture_object_trash($1::text[]) as n", [paths]);
      return r.rows[0]?.n ?? 0;
    },
  };
}

/** Storage 삭제가 2xx가 아니거나 네트워크 오류일 때. 메시지는 고정 코드만(경로·응답 본문 없음) */
export class CaptureRemoveError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CaptureRemoveError";
  }
}

export interface StorageRemoverOptions {
  /** Supabase 프로젝트 URL(예: https://<ref>.supabase.co) */
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Supabase Storage REST: DELETE /storage/v1/object/<bucket> {prefixes}. 없는 객체는 응답에서 빠질 뿐 오류가 아니다 */
export function createSupabaseStorageRemover(opts: StorageRemoverOptions): CaptureObjectRemover {
  if (!opts.url || !opts.serviceRoleKey) throw new Error("SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요합니다");
  const doFetch = opts.fetch ?? fetch;
  const endpoint = new URL(`/storage/v1/object/${CAPTURE_CLEANUP_SETTINGS.bucket}`, opts.url);
  const timeoutMs = opts.timeoutMs ?? CAPTURE_CLEANUP_SETTINGS.requestTimeoutMs;
  return {
    async remove(paths) {
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${opts.serviceRoleKey}`,
            apikey: opts.serviceRoleKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ prefixes: paths }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new CaptureRemoveError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error");
      }
      // 본문(삭제된 객체 목록)은 쓰지 않는다
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw new CaptureRemoveError(`http_${res.status}`);
    },
  };
}

/**
 * 정리 한 주기: 맡기 → 지우기 → ack를 배치마다. 한 배치라도 Storage 삭제가 실패하면 그 배치는 ack하지 않고 멈춘다
 * (다음 주기에 claim 재배정으로 다시). 실패해도 Worker를 멈추지 않고 로그만 남긴다.
 */
export async function runCaptureCleanup(
  store: CaptureTrashStore,
  remover: CaptureObjectRemover,
  log: Logger,
  limit: number = CAPTURE_CLEANUP_SETTINGS.batchLimit,
  maxBatches: number = CAPTURE_CLEANUP_SETTINGS.maxBatchesPerRun,
): Promise<void> {
  let claimed = 0;
  let cleaned = 0;
  try {
    for (let i = 0; i < maxBatches; i++) {
      const paths = await store.claim(limit);
      if (paths.length === 0) break;
      claimed += paths.length;
      await remover.remove(paths);
      cleaned += await store.ack(paths);
      if (paths.length < limit) break;
    }
    log({ event: "capture_cleanup", outcome: "done", claimed, cleaned });
  } catch (e) {
    log({
      event: "capture_cleanup",
      outcome: "failed",
      claimed,
      cleaned,
      reason: e instanceof CaptureRemoveError ? e.code : undefined,
      errorName: e instanceof Error ? e.name : "unknown",
    });
  }
}
