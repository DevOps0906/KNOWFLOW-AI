// 유튜브 자료의 DB 접근(task-027a 계약). 한 트랜잭션에서 청크 교체 → 장면 교체 → complete_job(모두 (job_id, attempt) 펜싱).
import type { Pool } from "pg";
import type { ChunkDraft, TimeLocator } from "../ingest/chunking.js";
import { INGEST_ERROR_CODES } from "../ingest/settings.js";
import { PermanentError } from "../runner.js";
import { YOUTUBE_ERROR_CODES } from "./settings.js";

export interface YoutubeVideo {
  video_id: string | null;
  duration_seconds: number | null;
}

/** replace_source_moments 장면 형식 */
export interface MomentDraft {
  moment_index: number;
  locator: TimeLocator;
  title: string;
  description: string;
}

export interface YoutubeStore {
  loadVideo(sourceId: string): Promise<YoutubeVideo | null>;
  /**
   * 청크·장면을 통째로 바꾸고 작업을 완료한다. 펜싱에 걸리면(다른 시도·running 아님·자료 삭제됨) 아무것도 바꾸지 않고 false.
   * 형식 거부(22023)는 PermanentError(invalid_chunks · invalid_moments)
   */
  replaceAndComplete(jobId: string, attempt: number, chunks: ChunkDraft<TimeLocator>[], moments: MomentDraft[]): Promise<boolean>;
}

export function createPgYoutubeStore(pool: Pick<Pool, "query" | "connect">): YoutubeStore {
  return {
    async loadVideo(sourceId) {
      const r = await pool.query<YoutubeVideo>("select video_id, duration_seconds from public.sources where id = $1", [sourceId]);
      return r.rows[0] ?? null;
    },
    async replaceAndComplete(jobId, attempt, chunks, moments) {
      const client = await pool.connect();
      // 형식 거부가 어느 단계에서 났는지에 따라 고정 코드를 고른다
      let invalidCode: string = INGEST_ERROR_CODES.invalidChunks;
      try {
        await client.query("begin");
        const step = async (sql: string, params: unknown[]) => (await client.query<{ ok: boolean }>(sql, params)).rows[0]?.ok === true;
        let ok = await step("select public.replace_source_chunks($1, $2, $3::jsonb) as ok", [jobId, attempt, JSON.stringify(chunks)]);
        if (ok) {
          invalidCode = YOUTUBE_ERROR_CODES.invalidMoments;
          ok = await step("select public.replace_source_moments($1, $2, $3::jsonb) as ok", [jobId, attempt, JSON.stringify(moments)]);
        }
        if (ok) ok = await step("select public.complete_job($1, $2) as ok", [jobId, attempt]);
        if (!ok) {
          await client.query("rollback");
          return false;
        }
        await client.query("commit");
        return true;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        if ((e as { code?: string }).code === "22023") throw new PermanentError(invalidCode);
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

// ── 메타데이터 재확인(task-027d) ──

/** 재확인 대상 자료. 삭제·비활성이면 Worker는 조회 없이 작업만 끝낸다 */
export interface RecheckTarget {
  video_id: string | null;
  duration_seconds: number | null;
  deleted: boolean;
  unavailable: boolean;
}

/** apply_source_recheck 결과 형식. missing(결과 없음)은 DB가 2회 연속일 때만 비활성으로 확정한다 */
export type RecheckResult =
  | { kind: "available"; title: string; channel_title: string; duration_seconds: number }
  | { kind: "unavailable" }
  | { kind: "missing" };

export interface SweepResult {
  enqueued: number;
  purged: number;
  /** 지운 오래된 failed 재확인 작업 수 */
  cleaned: number;
  /** 24시간 넘게 queued인 재확인 작업 수 */
  stale_queued: number;
}

export interface RecheckStore {
  loadRecheckTarget(sourceId: string): Promise<RecheckTarget | null>;
  /** 결과 반영 → complete_job을 한 트랜잭션에서. 펜싱에 걸리면 아무것도 바꾸지 않고 false. 형식 거부(22023)는 PermanentError */
  applyRecheckAndComplete(jobId: string, attempt: number, result: RecheckResult): Promise<boolean>;
  /** 파기 + 재확인 작업 생성(sweep_source_rechecks) */
  sweep(limit: number): Promise<SweepResult>;
}

export function createPgRecheckStore(pool: Pick<Pool, "query" | "connect">): RecheckStore {
  return {
    async loadRecheckTarget(sourceId) {
      const r = await pool.query<RecheckTarget>(
        `select s.video_id, s.duration_seconds, (s.deleted_at is not null or p.deleted_at is not null) as deleted,
                s.unavailable_at is not null as unavailable
           from public.sources s join public.projects p on p.id = s.project_id
          where s.id = $1`,
        [sourceId],
      );
      return r.rows[0] ?? null;
    },
    async applyRecheckAndComplete(jobId, attempt, result) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const step = async (sql: string, params: unknown[]) => (await client.query<{ ok: boolean }>(sql, params)).rows[0]?.ok === true;
        let ok = await step("select public.apply_source_recheck($1, $2, $3::jsonb) as ok", [jobId, attempt, JSON.stringify(result)]);
        if (ok) ok = await step("select public.complete_job($1, $2) as ok", [jobId, attempt]);
        if (!ok) {
          await client.query("rollback");
          return false;
        }
        await client.query("commit");
        return true;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        if ((e as { code?: string }).code === "22023") throw new PermanentError(YOUTUBE_ERROR_CODES.invalidRecheckResult);
        throw e;
      } finally {
        client.release();
      }
    },
    async sweep(limit) {
      const r = await pool.query<{ r: SweepResult }>("select public.sweep_source_rechecks($1) as r", [limit]);
      return r.rows[0]!.r;
    },
  };
}
