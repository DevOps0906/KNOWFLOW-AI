import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { RunOutcome } from "./runner.js";

const POLL_MS = 60_000;
const { runOnce, poolEnd } = vi.hoisted(() => ({ runOnce: vi.fn(), poolEnd: vi.fn(async () => {}) }));

vi.mock("./config.js", () => ({
  loadConfig: () => ({
    workerId: "w1",
    dbRole: "service_role",
    pollIntervalMs: 60_000,
    leaseSeconds: 120,
    heartbeatSeconds: 30,
    shutdownGraceMs: 600_000,
    metricsIntervalMs: 3_600_000,
    dummyHandlers: false,
  }),
}));
vi.mock("./db.js", () => ({
  createPool: () => ({ end: poolEnd }),
  verifyDbIdentity: async () => {},
  DbIdentityError: class extends Error {},
}));
vi.mock("./handlers.js", () => ({ buildHandlers: () => ({}) }));
vi.mock("./queue.js", () => ({ createPgQueue: () => ({}) }));
vi.mock("./log.js", () => ({ log: () => {} }));
vi.mock("./runner.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./runner.js")>()), runOnce }));

describe("main 루프 종료", () => {
  let before: Record<"SIGTERM" | "SIGINT", unknown[]>;
  let timeouts: MockInstance<typeof setTimeout>;

  beforeEach(() => {
    vi.resetModules();
    runOnce.mockReset();
    poolEnd.mockClear();
    before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
    timeouts = vi.spyOn(globalThis, "setTimeout");
  });

  afterEach(() => {
    for (const r of timeouts.mock.results) clearTimeout(r.value as NodeJS.Timeout);
    timeouts.mockRestore();
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      for (const l of process.listeners(signal)) if (!before[signal].includes(l)) process.off(signal, l);
    }
  });

  /** main이 등록한 핸들러만 호출한다(테스트 러너의 시그널 처리는 건드리지 않는다) */
  const sendSigterm = () => {
    for (const l of process.listeners("SIGTERM")) if (!before.SIGTERM.includes(l)) l("SIGTERM");
  };

  it.each<[string, () => RunOutcome]>([
    ["재시도 대기로 돌아간 작업", () => "requeued"],
    ["가져올 작업 없음", () => "idle"],
    [
      "일시 오류",
      () => {
        throw new Error("db down");
      },
    ],
  ])("처리 중 SIGTERM을 받으면 대기 없이 끝난다: %s", async (_name, finish) => {
    runOnce.mockImplementationOnce(async () => {
      sendSigterm();
      return finish();
    });

    await import("./main.js");

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(poolEnd).toHaveBeenCalledTimes(1);
    expect(timeouts.mock.calls.map((c) => c[1])).not.toContain(POLL_MS);
  });
});
