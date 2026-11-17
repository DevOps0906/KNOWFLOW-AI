import type pg from "pg";
import type { WorkerConfig } from "./config.js";
import { createGeminiSummaryProvider, createGeminiVideoSummaryProvider } from "./ingest/gemini-summary.js";
import { createIngestHandler } from "./ingest/handler.js";
import { createFixtureSourceReader, createStorageSourceReader } from "./ingest/source-reader.js";
import { createPgIngestStore } from "./ingest/store.js";
import { createStubSummaryProvider } from "./ingest/summary.js";
import type { Logger } from "./log.js";
import type { Handler, Handlers } from "./runner.js";
import { createStubVideoAnalyzer, type VideoAnalyzer } from "./youtube/analyzer.js";
import { createGeminiVideoAnalyzer } from "./youtube/gemini.js";
import { createStubMetadataProvider, createYoutubeDataApiProvider } from "./youtube/metadata.js";
import { createRecheckHandler } from "./youtube/recheck.js";
import { createPgRecheckStore, createPgYoutubeStore } from "./youtube/store.js";
import { createPgVideoSummaryStore, createStubVideoSummaryProvider } from "./youtube/summary.js";

// 더미 핸들러는 기동·전이 검증용이다(WORKER_DUMMY_HANDLERS=1, 로컬 DB 전용).
export const dummyHandler: Handler = async ({ progress, signal }) => {
  await progress("dummy", 50);
  await new Promise((resolve) => setTimeout(resolve, 100));
  signal.throwIfAborted();
};

export function buildHandlers(
  config: Pick<
    WorkerConfig,
    | "dummyHandlers"
    | "sourceReader"
    | "fixtureDir"
    | "supabaseUrl"
    | "supabaseServiceRoleKey"
    | "summaryProvider"
    | "geminiSummaryModel"
    | "youtubeEnabled"
    | "youtubeAnalyzer"
    | "geminiApiKey"
    | "geminiModel"
    | "youtubeMetadataProvider"
    | "youtubeWorkerApiKey"
  >,
  db: Pick<pg.Pool, "query" | "connect">,
  log?: Logger,
): Handlers {
  if (config.dummyHandlers) return { source_ingest: dummyHandler, report_generate: dummyHandler };
  const reader =
    config.sourceReader === "fixture" && config.fixtureDir
      ? createFixtureSourceReader(config.fixtureDir)
      : createStorageSourceReader({ url: config.supabaseUrl ?? "", serviceRoleKey: config.supabaseServiceRoleKey ?? "" });
  // 플래그가 꺼지면 유튜브 처리를 등록하지 않는다(들어온 유튜브 작업은 youtube_disabled로 영구 실패)
  let analyzer: VideoAnalyzer | undefined;
  if (config.youtubeEnabled) {
    analyzer =
      config.youtubeAnalyzer === "gemini"
        ? createGeminiVideoAnalyzer({ apiKey: config.geminiApiKey ?? "", model: config.geminiModel })
        : createStubVideoAnalyzer();
  }
  const summaryOpts = { apiKey: config.geminiApiKey ?? "", model: config.geminiSummaryModel };
  const handlers: Handlers = {
    source_ingest: createIngestHandler({
      store: createPgIngestStore(db),
      reader,
      summarizer:
        config.summaryProvider === "stub"
          ? createStubSummaryProvider()
          : config.summaryProvider === "gemini"
            ? createGeminiSummaryProvider(summaryOpts)
            : undefined,
      youtube: analyzer ? { analyzer, store: createPgYoutubeStore(db) } : undefined,
      // 자료 요약(유튜브·PDF)은 프로젝트 요약과 같은 공급자 설정을 따르고 유튜브 플래그와 무관하다
      sourceSummary:
        config.summaryProvider === "none"
          ? undefined
          : {
              provider: config.summaryProvider === "gemini" ? createGeminiVideoSummaryProvider(summaryOpts) : createStubVideoSummaryProvider(),
              store: createPgVideoSummaryStore(db),
            },
      log,
    }),
  };
  // 메타데이터 재확인(027d)도 플래그가 켜졌을 때만 등록한다(꺼져 있으면 들어온 재확인 작업은 no_handler로 닫힌다).
  if (config.youtubeEnabled) {
    const provider =
      config.youtubeMetadataProvider === "youtube"
        ? createYoutubeDataApiProvider({ apiKey: config.youtubeWorkerApiKey ?? "" })
        : createStubMetadataProvider();
    handlers.source_recheck = createRecheckHandler({ provider, store: createPgRecheckStore(db), log });
  }
  return handlers;
}
