import { describe, expect, it, vi } from "vitest";
import { isLocalDbUrl, loadConfig } from "../config.js";
import { buildHandlers } from "../handlers.js";
import { sanitize, type LogFields } from "../log.js";
import type { FailResult, Job, JobQueue } from "../queue.js";
import { PermanentError, runOnce, type Handlers } from "../runner.js";
import { createStubMetadataProvider, createYoutubeDataApiProvider, parseIsoDuration, type MetadataLookup, type VideoMetadataProvider } from "./metadata.js";
import { createRecheckHandler, judgeRecheck, RecheckUndeterminedError, runRecheckSweep } from "./recheck.js";
import { YOUTUBE_ERROR_CODES } from "./settings.js";
import { createPgRecheckStore, type RecheckResult, type RecheckStore, type RecheckTarget } from "./store.js";

// task-027d: 메타데이터 재확인 판정·videos.list 공급자·핸들러·스윕·배선(플래그)

const VIDEO_ID = "abcDEF12345";
const LOCAL = "postgres://u:p@localhost:5432/k";
const REMOTE = "postgres://u:p@db.abc.supabase.co:5432/k";

const video = (o: Partial<{ title: string; channelTitle: string; durationSeconds: number | null; privacyStatus: string; uploadStatus: string }> = {}) => ({
  title: "제목", channelTitle: "채널", durationSeconds: 600, privacyStatus: "public", uploadStatus: "processed", ...o,
});

describe("judgeRecheck", () => {
  it("비공개·업로드 삭제/거절은 즉시 비활성, 결과 없음은 missing(DB가 2회 연속일 때 확정), unlisted는 비활성 아님", () => {
    expect(judgeRecheck(null)).toEqual({ kind: "missing" });
    expect(judgeRecheck(video({ privacyStatus: "private" }))).toEqual({ kind: "unavailable" });
    expect(judgeRecheck(video({ uploadStatus: "deleted" }))).toEqual({ kind: "unavailable" });
    expect(judgeRecheck(video({ uploadStatus: "rejected" }))).toEqual({ kind: "unavailable" });
    expect(judgeRecheck(video({ privacyStatus: "unlisted" })).kind).toBe("available");
  });

  it("실제 길이로 갱신하고, 길이를 해석 못 하면 대체 없이 판정 불가", () => {
    expect(judgeRecheck(video({ durationSeconds: 615 }))).toEqual({ kind: "available", title: "제목", channel_title: "채널", duration_seconds: 615 });
    expect(() => judgeRecheck(video({ durationSeconds: null }))).toThrow(RecheckUndeterminedError);
  });

  it("길이 해석: 빈 값·형식 오류·음수·0·P·PT·정수 상한 초과는 null", () => {
    expect(parseIsoDuration("PT10M15S")).toBe(615);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    for (const bad of [undefined, "", "abc", "-PT5S", "PT-5S", "P0D", "PT0S", "P", "PT", "PT1.5S", "P24856D", "PT99999999999S", 600]) {
      expect(parseIsoDuration(bad)).toBeNull();
    }
  });
});

describe("videos.list 공급자", () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const signal = () => new AbortController().signal;

  it("키는 헤더로만 보내고(URL에 없음) 결과를 정리한다(양방향·폭 없는 문자 제거, 길이 해석)", async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      ok({ items: [{ snippet: { title: "새‮제목​", channelTitle: "채널" }, contentDetails: { duration: "PT10M15S" }, status: { privacyStatus: "public", uploadStatus: "processed" } }] }),
    );
    const p = createYoutubeDataApiProvider({ apiKey: "KEY-123", fetch: fetchMock as unknown as typeof fetch });
    const r = await p.lookup(VIDEO_ID, signal());
    expect(r).toEqual({ ok: true, video: { title: "새제목", channelTitle: "채널", durationSeconds: 615, privacyStatus: "public", uploadStatus: "processed" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://www.googleapis.com/youtube/v3/videos?part=snippet%2CcontentDetails%2Cstatus&id=${VIDEO_ID}`);
    expect(String(url)).not.toContain("KEY-123");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY-123");
  });

  it("결과 없음은 video null, 쿼터 초과(403 quota·429)·5xx·네트워크·이상한 응답은 판정 불가", async () => {
    const lookup = (impl: () => Promise<Response>) =>
      createYoutubeDataApiProvider({ apiKey: "k", fetch: impl as unknown as typeof fetch }).lookup(VIDEO_ID, signal());
    expect(await lookup(async () => ok({ items: [] }))).toEqual({ ok: true, video: null });
    for (const reason of ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"]) {
      expect(await lookup(async () => ok({ error: { code: 403, errors: [{ reason }] } }, 403))).toEqual({ ok: false, reason: "http_403_quota" });
    }
    expect(await lookup(async () => ok({}, 429))).toEqual({ ok: false, reason: "http_429" });
    expect(await lookup(async () => ok({}, 503))).toEqual({ ok: false, reason: "http_503" });
    expect(await lookup(async () => { throw new TypeError("fetch failed"); })).toEqual({ ok: false, reason: "network_error" });
    expect(await lookup(async () => new Response("not json"))).toEqual({ ok: false, reason: "invalid_response" });
    expect(await lookup(async () => ok({ items: "x" }))).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("요청 거절(400·401·키 권한 403·404)은 영구 실패(고정 코드)", async () => {
    const lookup = (impl: () => Promise<Response>) =>
      createYoutubeDataApiProvider({ apiKey: "k", fetch: impl as unknown as typeof fetch }).lookup(VIDEO_ID, signal());
    const cases: [number, unknown][] = [
      [400, { error: { errors: [{ reason: "badRequest" }] } }],
      [401, {}],
      [403, { error: { errors: [{ reason: "forbidden" }] } }],
      [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }],
      [404, {}],
    ];
    for (const [status, body] of cases) {
      const e = await lookup(async () => ok(body, status)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(PermanentError);
      expect((e as PermanentError).code).toBe(YOUTUBE_ERROR_CODES.recheckRequestRejected);
    }
  });

  it("임대 상실(abort)은 판정 불가가 아니라 그대로 던진다", async () => {
    const ac = new AbortController();
    const p = createYoutubeDataApiProvider({
      apiKey: "k",
      fetch: (async () => {
        ac.abort();
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(p.lookup(VIDEO_ID, ac.signal)).rejects.toThrow();
  });

  it("키 없이는 만들 수 없다", () => {
    expect(() => createYoutubeDataApiProvider({ apiKey: "" })).toThrow(/YOUTUBE_WORKER_API_KEY/);
  });
});

// ── 핸들러: 가짜 큐·저장소로 runOnce ──
const recheckJob = (attempt = 1): Job =>
  ({ id: "j1", user_id: "u1", source_id: "s1", report_id: null, job_type: "source_recheck", attempt_count: attempt, max_attempts: 3 });

function queueFor(job: Job): JobQueue & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    claim: async () => job,
    heartbeat: async () => true,
    progress: async () => true,
    complete: async () => {
      calls.push("complete");
      return true;
    },
    fail: async (_id, _a, code, retryable): Promise<FailResult> => {
      calls.push(`fail:${code}:${retryable}`);
      return retryable ? "requeued" : "failed";
    },
  };
}

function fakeStore(target: RecheckTarget | null, applyOk = true): RecheckStore & { applied: RecheckResult[] } {
  const applied: RecheckResult[] = [];
  return {
    applied,
    loadRecheckTarget: async () => target,
    applyRecheckAndComplete: async (_j, _a, result) => {
      applied.push(result);
      return applyOk;
    },
    sweep: async () => ({ enqueued: 0, purged: 0, cleaned: 0, stale_queued: 0 }),
  };
}

const fixedProvider = (result: MetadataLookup): VideoMetadataProvider & { calls: number } => {
  const p = {
    name: "stub" as const,
    calls: 0,
    async lookup() {
      p.calls++;
      return result;
    },
  };
  return p;
};

async function run(handlers: Handlers, logs: LogFields[] = []) {
  const q = queueFor(recheckJob());
  const outcome = await runOnce({ queue: q, handlers, leaseSeconds: 120, heartbeatSeconds: 30, log: (f) => void logs.push(f) });
  return { outcome, calls: q.calls };
}
const handlersFor = (provider: VideoMetadataProvider, store: RecheckStore, logs: LogFields[] = []) =>
  ({ source_recheck: createRecheckHandler({ provider, store, log: (f) => void logs.push(f) }) }) satisfies Handlers;

const TARGET: RecheckTarget = { video_id: VIDEO_ID, duration_seconds: 600, deleted: false, unavailable: false };

describe("재확인 핸들러", () => {
  it("길이가 다르면 갱신하고 숫자만 로그로 남긴다(제목·채널명 없음). 반영과 완료는 저장소가 한 트랜잭션으로", async () => {
    const store = fakeStore(TARGET);
    const logs: LogFields[] = [];
    const r = await run(handlersFor(fixedProvider({ ok: true, video: video({ title: "비밀 제목", channelTitle: "비밀 채널", durationSeconds: 615 }) }), store, logs), logs);
    expect(r.outcome).toBe("succeeded");
    expect(r.calls).toEqual([]); // runner는 complete를 부르지 않는다(저장소가 완료)
    expect(store.applied).toEqual([{ kind: "available", title: "비밀 제목", channel_title: "비밀 채널", duration_seconds: 615 }]);
    expect(logs).toContainEqual(expect.objectContaining({ event: "recheck_duration_changed", previousDurationSeconds: 600, durationSeconds: 615 }));
    const printed = JSON.stringify(logs.map(sanitize));
    expect(printed).not.toContain("비밀");
    expect(printed).toContain("\"durationSeconds\":615");
  });

  it("결과 없음은 missing으로, 키 권한 거절은 재시도 없는 영구 실패", async () => {
    const store = fakeStore(TARGET);
    await run(handlersFor(fixedProvider({ ok: true, video: null }), store));
    expect(store.applied).toEqual([{ kind: "missing" }]);
    const rejecting: VideoMetadataProvider = {
      name: "youtube",
      lookup: async () => {
        throw new PermanentError(YOUTUBE_ERROR_CODES.recheckRequestRejected);
      },
    };
    const r = await run(handlersFor(rejecting, fakeStore(TARGET)));
    expect(r.calls).toEqual([`fail:${YOUTUBE_ERROR_CODES.recheckRequestRejected}:false`]);
  });

  it("길이를 해석 못 하면 저장된 길이로 대체하지 않고 재시도", async () => {
    const store = fakeStore(TARGET);
    const r = await run(handlersFor(fixedProvider({ ok: true, video: video({ durationSeconds: null }) }), store));
    expect(r.calls).toEqual(["fail:handler_error:true"]);
    expect(store.applied).toEqual([]);
  });

  it("길이가 같으면 길이 변경 로그가 없다. 비공개 전환은 unavailable로 반영", async () => {
    const logs: LogFields[] = [];
    const store = fakeStore(TARGET);
    await run(handlersFor(fixedProvider({ ok: true, video: video() }), store, logs), logs);
    expect(logs.some((l) => l.event === "recheck_duration_changed")).toBe(false);
    const gone = fakeStore(TARGET);
    await run(handlersFor(fixedProvider({ ok: true, video: video({ privacyStatus: "private" }) }), gone));
    expect(gone.applied).toEqual([{ kind: "unavailable" }]);
  });

  it("판정 불가(쿼터 초과·장애)는 아무것도 반영하지 않고 재시도한다", async () => {
    const store = fakeStore(TARGET);
    const r = await run(handlersFor(fixedProvider({ ok: false, reason: "http_403" }), store));
    expect(r).toEqual({ outcome: "requeued", calls: ["fail:handler_error:true"] });
    expect(store.applied).toEqual([]);
  });

  it("삭제·비활성·없는 자료는 조회 없이 작업만 완료한다", async () => {
    for (const target of [{ ...TARGET, deleted: true }, { ...TARGET, unavailable: true }, null]) {
      const provider = fixedProvider({ ok: true, video: video() });
      const store = fakeStore(target);
      const r = await run(handlersFor(provider, store));
      expect(r).toEqual({ outcome: "succeeded", calls: ["complete"] });
      expect(provider.calls).toBe(0);
      expect(store.applied).toEqual([]);
    }
  });

  it("영상 ID가 이상하면 영구 실패, 펜싱에 걸리면 stale", async () => {
    const bad = await run(handlersFor(fixedProvider({ ok: true, video: video() }), fakeStore({ ...TARGET, video_id: "x" })));
    expect(bad.calls).toEqual([`fail:${YOUTUBE_ERROR_CODES.invalidVideo}:false`]);
    const stale = await run(handlersFor(fixedProvider({ ok: true, video: video() }), fakeStore(TARGET, false)));
    expect(stale).toEqual({ outcome: "stale", calls: [] });
  });
});

describe("스윕", () => {
  it("결과 숫자를 로그로 남기고, 실패해도 던지지 않는다", async () => {
    const logs: LogFields[] = [];
    const store = { ...fakeStore(TARGET), sweep: vi.fn(async () => ({ enqueued: 3, purged: 1, cleaned: 2, stale_queued: 0 })) };
    await runRecheckSweep(store, (f) => void logs.push(f), 50);
    expect(store.sweep).toHaveBeenCalledWith(50);
    expect(sanitize(logs[0]!)).toMatchObject({ event: "recheck_sweep", outcome: "done", enqueued: 3, purged: 1, cleaned: 2 });
    expect(logs).toHaveLength(1); // 밀린 작업이 없으면 경고 없음
    const failing = { ...fakeStore(TARGET), sweep: async () => Promise.reject(new Error("db down")) };
    await runRecheckSweep(failing, (f) => void logs.push(f));
    expect(logs[1]).toMatchObject({ event: "recheck_sweep", outcome: "failed", errorName: "Error" });
  });

  it("24시간 넘게 queued인 재확인 작업이 있으면 숫자만 경고 로그", async () => {
    const logs: LogFields[] = [];
    await runRecheckSweep({ ...fakeStore(TARGET), sweep: async () => ({ enqueued: 0, purged: 0, cleaned: 0, stale_queued: 7 }) }, (f) => void logs.push(f));
    expect(sanitize(logs[1]!)).toEqual({ event: "recheck_backlog_warning", staleQueued: 7 });
  });
});

// ── 배선: 플래그·pg 저장소 ──
function fakePool(failOn?: string) {
  const sql: string[] = [];
  const client = {
    query: async (text: string) => {
      sql.push(text.replace(/\s+/g, " ").trim());
      if (failOn && text.includes(failOn)) throw Object.assign(new Error("invalid"), { code: "22023" });
      return { rows: [{ ok: true, r: { enqueued: 2, purged: 0, cleaned: 0, stale_queued: 0 } }] };
    },
    release: () => {},
  };
  return { pool: { query: client.query, connect: async () => client } as never, sql };
}

describe("buildHandlers · pg 재확인 저장소", () => {
  const base = {
    dummyHandlers: false, sourceReader: "storage", fixtureDir: null, summaryProvider: "none", youtubeAnalyzer: "stub", geminiApiKey: null, geminiModel: "gemini-test",
    youtubeMetadataProvider: "stub", youtubeWorkerApiKey: null,
  } as const;

  it("플래그 꺼짐이면 재확인 핸들러를 등록하지 않는다(들어온 작업은 no_handler)", async () => {
    const { pool } = fakePool();
    const handlers = buildHandlers({ ...base, youtubeEnabled: false }, pool);
    expect(Object.keys(handlers)).toEqual(["source_ingest"]);
    expect((await run(handlers)).calls).toEqual(["fail:no_handler:false"]);
  });

  it("플래그 켜짐: 스텁 공급자로 한 트랜잭션에서 apply_source_recheck → complete_job", async () => {
    const { pool, sql } = fakePool();
    const handlers = buildHandlers({ ...base, youtubeEnabled: true }, pool);
    expect(Object.keys(handlers).sort()).toEqual(["source_ingest", "source_recheck"]);
    const store = createPgRecheckStore(pool);
    expect(await store.applyRecheckAndComplete("j1", 1, { kind: "unavailable" })).toBe(true);
    const tx = sql.filter((s) => /^(begin|commit|rollback)$|apply_source_recheck|complete_job/.test(s)).map((s) => s.match(/^(begin|commit|rollback)$|apply_source_recheck|complete_job/)![0]);
    expect(tx).toEqual(["begin", "apply_source_recheck", "complete_job", "commit"]);
    expect(await store.sweep(10)).toEqual({ enqueued: 2, purged: 0, cleaned: 0, stale_queued: 0 });
  });

  it("결과 형식 거부(22023)는 invalid_recheck_result로 영구 실패하고 롤백한다", async () => {
    const { pool, sql } = fakePool("apply_source_recheck");
    const e = await createPgRecheckStore(pool).applyRecheckAndComplete("j1", 1, { kind: "unavailable" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PermanentError);
    expect((e as PermanentError).code).toBe(YOUTUBE_ERROR_CODES.invalidRecheckResult);
    expect(sql.at(-1)).toBe("rollback");
  });

  it("스텁 공급자는 네트워크 없이 공개 영상으로 답한다", async () => {
    const r = await createStubMetadataProvider().lookup(VIDEO_ID, new AbortController().signal);
    expect(r).toMatchObject({ ok: true, video: { durationSeconds: 600, privacyStatus: "public" } });
  });
});

describe("config · 재확인 공급자", () => {
  it("기본은 스텁이고, 꺼져 있으면 키를 들고 있지 않는다", () => {
    expect(loadConfig({ DATABASE_URL: LOCAL, YOUTUBE_WORKER_API_KEY: "k" })).toMatchObject({ youtubeMetadataProvider: "stub", youtubeWorkerApiKey: null });
    expect(() => loadConfig({ DATABASE_URL: LOCAL, YOUTUBE_METADATA_PROVIDER: "other" })).toThrow(/YOUTUBE_METADATA_PROVIDER/);
  });

  it("youtube 공급자는 올바른 YOUTUBE_WORKER_API_KEY가 필요하다(메시지에 키 없음)", () => {
    const env = { DATABASE_URL: LOCAL, YOUTUBE_ENABLED: "1", YOUTUBE_METADATA_PROVIDER: "youtube" };
    expect(() => loadConfig(env)).toThrow(/YOUTUBE_WORKER_API_KEY/);
    try {
      loadConfig({ ...env, YOUTUBE_WORKER_API_KEY: "bad key\nX-Injected: 1" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("bad key");
    }
    expect(loadConfig({ ...env, YOUTUBE_WORKER_API_KEY: "AIza-w" })).toMatchObject({ youtubeMetadataProvider: "youtube", youtubeWorkerApiKey: "AIza-w" });
    // 웹 키 이름(YOUTUBE_API_KEY)은 Worker가 읽지 않는다
    expect(() => loadConfig({ ...env, YOUTUBE_API_KEY: "AIza-web" })).toThrow(/YOUTUBE_WORKER_API_KEY/);
  });

  it("운영에서 플래그를 켜면 스텁 메타데이터 공급자는 거부한다", () => {
    expect(() => loadConfig({ DATABASE_URL: REMOTE, YOUTUBE_ENABLED: "1", YOUTUBE_ANALYZER: "gemini", GEMINI_API_KEY: "g" })).toThrow(/스텁 메타데이터/);
  });
});

describe("config · 로컬 DB 가드(pg 해석기 기준)", () => {
  it("pg가 실제로 접속할 호스트로 판단한다(쿼리 host·hostaddr·여러 호스트·유닉스 소켓 우회 차단)", () => {
    for (const url of ["postgres://u:p@db:5432/k", "postgres://u:p@localhost/k", "postgres://u:p@127.0.0.1/k", "postgres://u:p@[::1]:5432/k", "postgres://u:p@LOCALHOST/k"]) {
      expect(isLocalDbUrl(url), url).toBe(true);
    }
    for (const url of [
      "postgres://u:p@localhost/k?host=db.remote",
      "postgres://u:p@db/k?host=10.0.0.5",
      "postgres://u:p@localhost/k?hostaddr=1.2.3.4",
      "postgres://u:p@localhost,remote.example/k",
      "postgres:///k?host=/var/run/postgresql",
      "socket:/cloudsql/proj:region:inst?db=k",
      "postgres://u:p@db.abc.supabase.co:5432/k",
      "postgres://u:p@localhost.evil.example/k",
      "not a url",
    ]) {
      expect(isLocalDbUrl(url), url).toBe(false);
    }
  });

  it("가드를 쓰는 모든 설정(더미·고정 파일·스텁 요약·스텁 분석기·스텁 메타데이터)이 우회 URL을 거부한다", () => {
    const bypass = "postgres://u:p@localhost/k?host=db.remote";
    expect(() => loadConfig({ DATABASE_URL: bypass, WORKER_DUMMY_HANDLERS: "1" })).toThrow(/더미 핸들러/);
    expect(() => loadConfig({ DATABASE_URL: bypass, WORKER_SOURCE_READER: "fixture", WORKER_FIXTURE_DIR: "/f" })).toThrow(/고정 파일 어댑터/);
    expect(() => loadConfig({ DATABASE_URL: bypass, WORKER_SUMMARY_PROVIDER: "stub" })).toThrow(/스텁 요약/);
    expect(() => loadConfig({ DATABASE_URL: bypass, YOUTUBE_ENABLED: "1" })).toThrow(/스텁 영상 분석기/);
    expect(() =>
      loadConfig({ DATABASE_URL: bypass, YOUTUBE_ENABLED: "1", YOUTUBE_ANALYZER: "gemini", GEMINI_API_KEY: "g" }),
    ).toThrow(/스텁 메타데이터/);
    // 로컬이면 모두 허용
    expect(
      loadConfig({
        DATABASE_URL: "postgres://u:p@db:5432/k", WORKER_DUMMY_HANDLERS: "1", WORKER_SOURCE_READER: "fixture", WORKER_FIXTURE_DIR: "/f",
        WORKER_SUMMARY_PROVIDER: "stub", YOUTUBE_ENABLED: "1",
      }),
    ).toMatchObject({ dummyHandlers: true, sourceReader: "fixture", summaryProvider: "stub", youtubeAnalyzer: "stub", youtubeMetadataProvider: "stub" });
  });
});
