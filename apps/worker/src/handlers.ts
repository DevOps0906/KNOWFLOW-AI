import type pg from "pg";
import type { WorkerConfig } from "./config.js";
import { createIngestHandler } from "./ingest/handler.js";
import { createFixtureSourceReader, createStorageSourceReader } from "./ingest/source-reader.js";
import { createPgIngestStore } from "./ingest/store.js";
import { createStubSummaryProvider } from "./ingest/summary.js";
import type { Logger } from "./log.js";
import type { Handler, Handlers } from "./runner.js";

// 더미 핸들러는 기동·전이 검증용이다(WORKER_DUMMY_HANDLERS=1, 로컬 DB 전용).
export const dummyHandler: Handler = async ({ progress, signal }) => {
  await progress("dummy", 50);
  await new Promise((resolve) => setTimeout(resolve, 100));
  signal.throwIfAborted();
};

export function buildHandlers(
  config: Pick<WorkerConfig, "dummyHandlers" | "sourceReader" | "fixtureDir" | "summaryProvider">,
  db: Pick<pg.Pool, "query" | "connect">,
  log?: Logger,
): Handlers {
  if (config.dummyHandlers) return { source_ingest: dummyHandler, report_generate: dummyHandler };
  const reader =
    config.sourceReader === "fixture" && config.fixtureDir ? createFixtureSourceReader(config.fixtureDir) : createStorageSourceReader();
  return {
    source_ingest: createIngestHandler({
      store: createPgIngestStore(db),
      reader,
      summarizer: config.summaryProvider === "stub" ? createStubSummaryProvider() : undefined,
      log,
    }),
  };
}
