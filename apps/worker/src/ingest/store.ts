// 자료 처리의 DB 접근. 청크 교체와 완료는 (job_id, attempt)로 펜싱된 한 트랜잭션에서 한다(task-011 구현 결정 8).
import type { Pool } from "pg";
import { PermanentError } from "../runner.js";
import type { ChunkDraft } from "./chunking.js";
import { INGEST_ERROR_CODES } from "./settings.js";

export interface IngestSource {
  id: string;
  project_id: string;
  user_id: string;
  source_type: string;
  title: string;
  storage_path: string | null;
  content_hash: string | null;
  deleted: boolean;
}

export interface UsageEvent {
  userId: string;
  projectId: string;
  eventType: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface IngestStore {
  loadSource(sourceId: string): Promise<IngestSource | null>;
  /**
   * 기존 청크를 지우고 새 청크를 넣은 뒤 작업을 완료한다. 펜싱에 걸리면(다른 시도·running 아님·자료 삭제됨) 아무것도 바꾸지 않고 false.
   * 청크 형식 거부(22023)는 PermanentError(invalid_chunks)
   */
  replaceChunksAndComplete(jobId: string, attempt: number, chunks: ChunkDraft[]): Promise<boolean>;
  projectNeedsSummary(projectId: string): Promise<boolean>;
  /** summary가 비어 있을 때만 저장한다(첫 자료 경합 처리). 저장했으면 true */
  saveInitialSummary(projectId: string, summary: string, questions: string[]): Promise<boolean>;
  recordUsage(event: UsageEvent): Promise<void>;
}

export function createPgIngestStore(pool: Pick<Pool, "query" | "connect">): IngestStore {
  return {
    async loadSource(sourceId) {
      const r = await pool.query<IngestSource>(
        `select id, project_id, user_id, source_type, title, storage_path, content_hash, deleted_at is not null as deleted
           from public.sources where id = $1`,
        [sourceId],
      );
      return r.rows[0] ?? null;
    },
    async replaceChunksAndComplete(jobId, attempt, chunks) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const replaced = await client.query<{ ok: boolean }>("select public.replace_source_chunks($1, $2, $3::jsonb) as ok", [
          jobId,
          attempt,
          JSON.stringify(chunks),
        ]);
        if (replaced.rows[0]?.ok !== true) {
          await client.query("rollback");
          return false;
        }
        const done = await client.query<{ ok: boolean }>("select public.complete_job($1, $2) as ok", [jobId, attempt]);
        if (done.rows[0]?.ok !== true) {
          await client.query("rollback");
          return false;
        }
        await client.query("commit");
        return true;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        // 청크 형식 거부는 다시 해도 같으므로 영구 실패(고정 코드)로 닫는다
        if ((e as { code?: string }).code === "22023") throw new PermanentError(INGEST_ERROR_CODES.invalidChunks);
        throw e;
      } finally {
        client.release();
      }
    },
    async projectNeedsSummary(projectId) {
      const r = await pool.query<{ ok: boolean }>(
        "select summary is null as ok from public.projects where id = $1 and deleted_at is null",
        [projectId],
      );
      return r.rows[0]?.ok === true;
    },
    async saveInitialSummary(projectId, summary, questions) {
      const r = await pool.query(
        `update public.projects set summary = $2, suggested_questions = $3::jsonb
          where id = $1 and summary is null and deleted_at is null`,
        [projectId, summary, JSON.stringify(questions)],
      );
      return r.rowCount === 1;
    },
    async recordUsage(e) {
      await pool.query(
        `insert into public.usage_events (user_id, project_id, event_type, provider, model, input_tokens, output_tokens)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [e.userId, e.projectId, e.eventType, e.provider, e.model, e.inputTokens, e.outputTokens],
      );
    },
  };
}
