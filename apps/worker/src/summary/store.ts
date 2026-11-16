// 영상 요약의 DB 접근(task-029a). 쓰기는 service_role RPC save_source_summary만 쓴다.
import type { Pool } from "pg";
import type { SummaryChunk, SummarySentence, SummaryStore } from "./video-summary.js";

export function createPgSummaryStore(pool: Pick<Pool, "query">): SummaryStore {
  return {
    async loadChunks(sourceId) {
      const r = await pool.query<SummaryChunk>(
        "select id as chunk_id, chunk_index, content from public.source_chunks where source_id = $1 order by chunk_index",
        [sourceId],
      );
      return r.rows;
    },
    async saveSourceSummary(jobId: string, sentences: SummarySentence[], model: string) {
      const r = await pool.query<{ ok: boolean }>("select public.save_source_summary($1, $2::jsonb, $3) as ok", [
        jobId,
        JSON.stringify(sentences),
        model,
      ]);
      return r.rows[0]?.ok === true;
    },
  };
}
