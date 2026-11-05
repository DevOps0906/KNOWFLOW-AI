import type { Handler, Handlers } from "./runner.js";

// 추출·청킹·임베딩은 task-011에서 이 자리에 붙는다. 그 전까지의 더미 핸들러는 기동·전이 검증용이다.
export const dummyHandler: Handler = async ({ progress, signal }) => {
  await progress("dummy", 50);
  await new Promise((resolve) => setTimeout(resolve, 100));
  signal.throwIfAborted();
};

export function buildHandlers(opts: { dummy: boolean }): Handlers {
  return opts.dummy ? { source_ingest: dummyHandler, report_generate: dummyHandler } : {};
}