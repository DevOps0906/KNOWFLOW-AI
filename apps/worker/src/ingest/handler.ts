// source_ingest 핸들러(task-011): 원본 읽기 → parsePdf(격리) → 청킹 → 펜싱된 청크 교체+완료 → 후행 요약.
// 청크 본문은 로그에 남기지 않는다. 월 처리 차감은 등록 때 enqueue_job이 했으므로 여기서 하지 않는다.
import type { Logger } from "../log.js";
import { parsePdf } from "../pdf/parser.js";
import { PermanentError, StaleAttemptError, type Handler, type HandlerResult } from "../runner.js";
import { chunkPages, type ChunkDraft } from "./chunking.js";
import { INGEST_ERROR_CODES } from "./settings.js";
import type { SourceReader } from "./source-reader.js";
import type { IngestSource, IngestStore } from "./store.js";
import { buildSummaryPrompt, validateSummary, type SummaryProvider } from "./summary.js";

export interface IngestDeps {
  store: IngestStore;
  reader: SourceReader;
  /** 없으면 요약 단계를 건너뛴다 */
  summarizer?: SummaryProvider;
  parse?: typeof parsePdf;
  log?: Logger;
}

const fail = (code: string) => new PermanentError(code);

/** 첫 자료 요약. summary가 이미 있으면 건너뛰고, 경합으로 다른 자료가 먼저 저장했으면 버린다. */
export async function runSummaryStep(
  deps: Pick<IngestDeps, "store"> & { summarizer: SummaryProvider },
  source: Pick<IngestSource, "project_id" | "user_id">,
  chunks: Pick<ChunkDraft, "content">[],
): Promise<"skipped" | "saved" | "lost_race"> {
  const { store, summarizer } = deps;
  if (!(await store.projectNeedsSummary(source.project_id))) return "skipped";
  const raw = await summarizer.summarize(buildSummaryPrompt(chunks.map((c) => c.content)));
  // 공급자 호출은 결과가 쓸모없어도 사용 기록에 남긴다
  await store.recordUsage({
    userId: source.user_id,
    projectId: source.project_id,
    eventType: "project_summary",
    provider: summarizer.name,
    model: summarizer.model,
    inputTokens: raw.inputTokens ?? null,
    outputTokens: raw.outputTokens ?? null,
  });
  const { summary, questions } = validateSummary(raw);
  return (await store.saveInitialSummary(source.project_id, summary, questions)) ? "saved" : "lost_race";
}

export function createIngestHandler(deps: IngestDeps): Handler {
  const parse = deps.parse ?? parsePdf;
  return async ({ job, signal, progress }): Promise<HandlerResult> => {
    if (!job.source_id) throw fail(INGEST_ERROR_CODES.invalidJob);
    await progress("validate", 5);
    const source = await deps.store.loadSource(job.source_id);
    if (!source) throw fail(INGEST_ERROR_CODES.sourceNotFound);
    if (source.user_id !== job.user_id) throw fail(INGEST_ERROR_CODES.sourceOwnerMismatch);
    if (source.deleted) throw fail(INGEST_ERROR_CODES.sourceDeleted);
    // url 본문 추출은 task-009 완료 뒤 연결한다
    if (source.source_type !== "pdf") throw fail(INGEST_ERROR_CODES.unsupportedSourceType);
    if (!source.storage_path || !source.content_hash) throw fail(INGEST_ERROR_CODES.invalidSource);

    const bytes = await deps.reader.read(source.storage_path, signal);
    signal.throwIfAborted();
    await progress("extract_text", 15);
    const parsed = await parse(bytes, source.content_hash, { signal });

    await progress("chunk", 70);
    const chunks = chunkPages(parsed.pages);
    if (chunks.length === 0) throw fail(INGEST_ERROR_CODES.noChunks);
    // 스캔으로 건너뛴 쪽 수를 남긴다(숫자만)
    deps.log?.({
      event: "source_extracted",
      jobId: job.id,
      attempt: job.attempt_count,
      pages: parsed.pageCount,
      skippedPages: parsed.skippedPages.length,
      chunks: chunks.length,
    });

    await progress("index", 85);
    signal.throwIfAborted();
    if (!(await deps.store.replaceChunksAndComplete(job.id, job.attempt_count, chunks))) throw new StaleAttemptError();

    const summarizer = deps.summarizer;
    return {
      completed: true,
      afterComplete: summarizer ? () => runSummaryStep({ store: deps.store, summarizer }, source, chunks) : undefined,
    };
  };
}
