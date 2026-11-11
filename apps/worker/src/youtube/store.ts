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
