// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSourceHandlers, type SourceAuditEvent, type SourcesBackend } from "@/lib/storage/handlers";
import { readYoutubeConfig, youtubeConfigProblem, youtubeUsable, type YoutubeConfig } from "./config";
import { createYoutubeDataApiProvider, parseIsoDuration, type VideoMetadata, type VideoMetadataProvider } from "./metadata";
import { createYoutubeSources, youtubeRequestHash, type RegisterRpcResult } from "./register";
import { metadataProviderFor } from "./service";
import { canonicalYoutubeUrl, parseYoutubeVideoId } from "./url";

const SITE = "https://app.example.test";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ID = "dQw4w9WgXcQ";

const ON: YoutubeConfig = { enabled: true, provider: "stub", apiKey: undefined, allowStub: true, registerConfigured: true };

const video = (over: Partial<VideoMetadata> = {}): VideoMetadata => ({
  title: "영상",
  channelTitle: "채널",
  durationSeconds: 600,
  privacyStatus: "public",
  uploadStatus: "processed",
  embeddable: true,
  madeForKids: false,
  ageRestricted: false,
  regionBlocked: false,
  liveBroadcastContent: "none",
  ...over,
});

function setup(opts: { config?: YoutubeConfig; lookup?: VideoMetadataProvider["lookup"]; rpc?: RegisterRpcResult; projectExists?: boolean } = {}) {
  const logs: SourceAuditEvent[] = [];
  const lookup = vi.fn(opts.lookup ?? (async () => ({ ok: true as const, video: video() })));
  const provider = vi.fn(() => ({ lookup }));
  const register = vi.fn(async () => opts.rpc ?? ({ ok: true, sourceId: "s1", jobId: "j1", duplicate: false } as const));
  const backend: SourcesBackend = {
    getUserId: vi.fn(async () => USER),
    projectExists: vi.fn(async () => opts.projectExists ?? true),
    createUploadUrl: vi.fn(),
    readHead: vi.fn(),
    register: vi.fn(),
  };
  const youtube = createYoutubeSources({ config: () => opts.config ?? ON, provider, register });
  const handlers = createSourceHandlers({ backend, youtube, siteUrl: SITE, log: (e) => logs.push(e) });
  return { handlers, provider, lookup, register, backend, logs };
}

const post = (body: unknown, key: string | null = "key-1") =>
  new Request(`${SITE}/api/projects/${PROJECT}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { "Idempotency-Key": key }) },
    body: JSON.stringify(body),
  });

const yt = (over: Record<string, unknown> = {}) => ({ source_type: "youtube", url: `https://youtu.be/${ID}`, ...over });

async function send(s: ReturnType<typeof setup>, body: unknown, key: string | null = "key-1") {
  const res = await s.handlers.post(post(body, key), PROJECT);
  return { status: res.status, body: (await res.json()) as { error?: { code: string; message: string } } & Record<string, unknown> };
}

describe("유튜브 URL 파싱", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `http://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&t=30s`,
    `https://www.youtube.com/watch?v=${ID}&list=PL1234567890`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `  https://WWW.YOUTUBE.COM/watch?v=${ID}  `,
  ])("허용: %s", (url) => {
    expect(parseYoutubeVideoId(url)).toBe(ID);
  });

  it.each([
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://user@youtu.be/${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `https://www.youtube.com:443/watch?v=${ID}`,
    `http://www.youtube.com:80/watch?v=${ID}`,
    `https://youtu.be:443/${ID}`,
    `https://www.youtube.com:/watch?v=${ID}`,
    `https://www.youtube.com/redirect?q=https://evil.test&v=${ID}`,
    `https://www.youtube.com/playlist?list=PL1234567890`,
    `https://www.youtube.com/channel/UC1234567890`,
    `https://www.youtube.com/@handle`,
    `https://www.youtube.com/watch?list=PL1234567890`,
    `https://www.youtube.com/watch?v=${ID}&v=aaaaaaaaaaa`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://youtu.be/${ID}/extra`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtube.com.evil.test/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    `javascript:alert(1)`,
    "",
    42,
  ])("거부: %s", (url) => {
    expect(parseYoutubeVideoId(url)).toBeNull();
  });

  it("정규 URL은 watch?v= 형태", () => {
    expect(canonicalYoutubeUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe("설정·플래그", () => {
  it("기본은 꺼짐·스텁", () => {
    expect(readYoutubeConfig({}, true)).toEqual({ enabled: false, provider: "stub", apiKey: undefined, allowStub: false, registerConfigured: true });
    expect(readYoutubeConfig({ YOUTUBE_METADATA_PROVIDER: "other" }, true).provider).toBe("stub");
    expect(youtubeUsable(readYoutubeConfig({}, true))).toBe(false);
  });
  it("켜졌는데 스텁 허용·키·등록 설정이 없으면 쓸 수 없다(NODE_ENV와 무관)", () => {
    const usable = (env: Record<string, string | undefined>, register = true) => youtubeUsable(readYoutubeConfig(env, register));
    for (const NODE_ENV of ["development", "test", "production", undefined]) {
      expect(youtubeConfigProblem(readYoutubeConfig({ NODE_ENV, YOUTUBE_ENABLED: "true" }, true))).toBe("stub_not_allowed");
      expect(youtubeConfigProblem(readYoutubeConfig({ NODE_ENV, YOUTUBE_ENABLED: "true", YOUTUBE_ALLOW_STUB: "true" }, true))).toBe("stub_not_allowed");
    }
    expect(youtubeConfigProblem(readYoutubeConfig({ YOUTUBE_ENABLED: "true", YOUTUBE_METADATA_PROVIDER: "youtube" }, true))).toBe("api_key_missing");
    expect(youtubeConfigProblem(readYoutubeConfig({ YOUTUBE_ENABLED: "true", YOUTUBE_ALLOW_STUB: "1" }, false))).toBe("register_not_configured");
    expect(usable({ YOUTUBE_ENABLED: "true" })).toBe(false);
    expect(usable({ YOUTUBE_ENABLED: "true", YOUTUBE_METADATA_PROVIDER: "youtube", YOUTUBE_API_KEY: "k" })).toBe(true);
    expect(usable({ YOUTUBE_ENABLED: "true", YOUTUBE_METADATA_PROVIDER: "youtube", YOUTUBE_API_KEY: "k" }, false)).toBe(false);
    expect(usable({ YOUTUBE_ENABLED: "true", YOUTUBE_ALLOW_STUB: "1" })).toBe(true); // 로컬·테스트 스텁
  });
  it("실제 공급자는 youtube를 명시하고 키가 있을 때만", () => {
    const fetchSpy = vi.fn();
    metadataProviderFor(ON, fetchSpy as unknown as typeof fetch).lookup(ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("A-04 유튜브 등록", () => {
  it("플래그가 꺼지면 공급자(키)·videos.list를 부르기 전에 422", async () => {
    const s = setup({ config: { ...ON, enabled: false } });
    const r = await send(s, yt());
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("youtube_disabled");
    expect(s.provider).not.toHaveBeenCalled();
    expect(s.lookup).not.toHaveBeenCalled();
    expect(s.register).not.toHaveBeenCalled();
  });

  it("유튜브 구현이 주입되지 않아도 422", async () => {
    const backend = { getUserId: async () => USER, projectExists: async () => true } as unknown as SourcesBackend;
    const res = await createSourceHandlers({ backend, siteUrl: SITE, log: () => {} }).post(post(yt()), PROJECT);
    expect(res.status).toBe(422);
  });

  it.each([
    ["스텁 허용 없음", { allowStub: false }],
    ["service_role 등 등록 설정 없음", { registerConfigured: false }],
    ["실제 공급자인데 키 없음", { provider: "youtube" as const, apiKey: undefined }],
  ])("켜졌는데 %s이면 503이고 videos.list를 부르지 않는다", async (_, over) => {
    const s = setup({ config: { ...ON, ...over } });
    const r = await send(s, yt());
    expect(r.status).toBe(503);
    expect(r.body.error?.code).toBe("youtube_unavailable");
    expect(s.provider).not.toHaveBeenCalled();
    expect(s.lookup).toHaveBeenCalledTimes(0);
    expect(s.register).not.toHaveBeenCalled();
  });

  it("허용 외 URL은 videos.list 전에 422", async () => {
    const s = setup();
    const r = await send(s, yt({ url: "https://www.youtube.com/playlist?list=PL1" }));
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("invalid_youtube_url");
    expect(s.lookup).not.toHaveBeenCalled();
  });

  it("남의 프로젝트면 videos.list 전에 404", async () => {
    const s = setup({ projectExists: false });
    expect((await send(s, yt())).status).toBe(404);
    expect(s.lookup).not.toHaveBeenCalled();
  });

  it("멱등 키가 없으면 400", async () => {
    expect((await send(setup(), yt(), null)).status).toBe(400);
    // 본문의 키는 받지 않는다(A-04 공통 규칙: Idempotency-Key 헤더)
    expect((await send(setup(), yt({ idempotencyKey: "key-1" }), null)).status).toBe(400);
    expect((await send(setup(), yt(), "key with space")).status).toBe(400);
  });

  it.each([
    ["결과 없음(삭제·비공개)", null, "video_unavailable"],
    ["비공개", video({ privacyStatus: "private" }), "video_unavailable"],
    ["미등록", video({ privacyStatus: "unlisted" }), "video_unavailable"],
    ["임베드 불가", video({ embeddable: false }), "video_not_embeddable"],
    ["연령 제한", video({ ageRestricted: true }), "video_restricted"],
    ["지역 제한", video({ regionBlocked: true }), "video_restricted"],
    ["라이브", video({ liveBroadcastContent: "live" }), "video_live"],
    ["예정 방송", video({ liveBroadcastContent: "upcoming" }), "video_live"],
    ["어린이용", video({ madeForKids: true }), "video_made_for_kids"],
  ] as const)("동기 거절 %s → 422", async (_, v, code) => {
    const s = setup({ lookup: async () => ({ ok: true, video: v }) });
    const r = await send(s, yt());
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe(code);
    expect(r.body.error?.message).toBeTruthy();
    expect(s.register).not.toHaveBeenCalled();
  });

  it("videos.list 장애는 502(등록 안 함)", async () => {
    const s = setup({ lookup: async () => ({ ok: false }) });
    expect((await send(s, yt())).status).toBe(502);
    expect(s.register).not.toHaveBeenCalled();
  });

  it("통과하면 정규화된 입력·(project_id, video_id) 해시로 등록하고 202", async () => {
    const s = setup();
    const r = await send(s, yt({ url: `https://www.youtube.com/shorts/${ID}?feature=share` }));
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ sourceId: "s1", jobId: "j1", duplicate: false, status: "queued" });
    expect(s.register).toHaveBeenCalledWith({
      userId: USER,
      projectId: PROJECT,
      videoId: ID,
      title: "영상",
      channelTitle: "채널",
      durationSeconds: 600,
      idempotencyKey: "key-1",
      requestHash: youtubeRequestHash(PROJECT, ID),
    });
    expect(s.logs.at(-1)).toMatchObject({ event: "register", outcome: "success" });
    expect(JSON.stringify(s.logs)).not.toContain("youtube.com/");
  });

  it("멱등 해시는 URL 형태와 무관하게 (project_id, video_id)로만 정해진다", () => {
    expect(youtubeRequestHash(PROJECT, ID)).toMatch(/^[0-9a-f]{64}$/);
    expect(youtubeRequestHash(PROJECT, ID)).toBe(youtubeRequestHash(PROJECT, ID));
    expect(youtubeRequestHash(PROJECT, ID)).not.toBe(youtubeRequestHash(PROJECT, "aaaaaaaaaaa"));
    expect(youtubeRequestHash(PROJECT, ID)).not.toBe(youtubeRequestHash(USER, ID));
  });

  it.each([
    [{ code: "23505", message: "duplicate_video" }, 409, "duplicate_video"],
    [{ code: "KF409" }, 409, "conflict"],
    [{ code: "KF410" }, 409, "conflict"],
    [{ code: "KF413" }, 422, "video_too_long"],
    [{ code: "KF429", message: "quota_exceeded", hint: "video_seconds" }, 429, "limit_exceeded"],
    [{ code: "KF429", message: "quota_exceeded", hint: "source_jobs" }, 429, "limit_exceeded"],
    [{ code: "KF429", message: "source_limit_exceeded" }, 429, "limit_exceeded"],
    [{ code: "P0002" }, 404, "not_found"],
    [{ code: "22023" }, 422, "invalid_input"],
    [{ code: "XX000" }, 500, "server_error"],
  ])("RPC 오류 %o → %i", async (error, status, code) => {
    const r = await send(setup({ rpc: { ok: false, error } }), yt());
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(code);
  });

  it("KF429는 HINT로 한도 문구를 구분한다", async () => {
    const video = await send(setup({ rpc: { ok: false, error: { code: "KF429", hint: "video_seconds" } } }), yt());
    const jobs = await send(setup({ rpc: { ok: false, error: { code: "KF429", hint: "source_jobs" } } }), yt());
    const count = await send(setup({ rpc: { ok: false, error: { code: "KF429", hint: null } } }), yt());
    // details에 있어도 HINT가 아니면 영상 시간 한도로 보지 않는다
    const detailsOnly = await send(setup({ rpc: { ok: false, error: { code: "KF429", details: "video_seconds" } } }), yt());
    expect(video.body.error?.message).toContain("영상 처리 시간");
    for (const r of [jobs, count, detailsOnly]) expect(r.body.error?.message).not.toContain("영상 처리 시간");
  });
});

describe("videos.list 공급자(fetch 목, 실호출 없음)", () => {
  const item = {
    snippet: { title: " 제목\u0000 ", channelTitle: "채널", liveBroadcastContent: "none" },
    contentDetails: { duration: "PT1H2M3S", contentRating: {}, regionRestriction: { blocked: ["US"] } },
    status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true, madeForKids: false },
  };

  it("키는 헤더로만 보내고 URL에 넣지 않는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [item] }));
    const r = await createYoutubeDataApiProvider("SECRET", fetchMock as unknown as typeof fetch).lookup(ID);
    expect(r).toEqual({ ok: true, video: expect.objectContaining({ title: "제목", durationSeconds: 3723, regionBlocked: false }) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).not.toContain("SECRET");
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
    // id 필터와 maxResults를 함께 쓰면 400(incompatibleParameters)이므로 파라미터를 고정한다
    expect(Object.fromEntries(url.searchParams)).toEqual({ part: "snippet,contentDetails,status", id: ID });
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("SECRET");
  });

  it("제목·채널명에서 양방향 제어·폭 없는 문자를 지운다", async () => {
    const tricky = { ...item, snippet: { title: "a‮b⁦c⁩​d﻿‏", channelTitle: "‪채‬널‍", liveBroadcastContent: "none" } };
    const r = await createYoutubeDataApiProvider("k", (async () => Response.json({ items: [tricky] })) as unknown as typeof fetch).lookup(ID);
    expect(r).toEqual({ ok: true, video: expect.objectContaining({ title: "abcd", channelTitle: "채널" }) });
    const only = { ...item, snippet: { title: "‮​", channelTitle: "x", liveBroadcastContent: "none" } };
    const r2 = await createYoutubeDataApiProvider("k", (async () => Response.json({ items: [only] })) as unknown as typeof fetch).lookup(ID);
    expect(r2).toEqual({ ok: true, video: expect.objectContaining({ title: "제목 없음" }) });
  });

  it("지역·연령 제한을 해석한다", async () => {
    const restricted = { ...item, contentDetails: { duration: "PT10S", contentRating: { ytRating: "ytAgeRestricted" }, regionRestriction: { allowed: ["US"] } } };
    const fetchMock = vi.fn(async () => Response.json({ items: [restricted] }));
    const r = await createYoutubeDataApiProvider("k", fetchMock as unknown as typeof fetch).lookup(ID);
    expect(r).toEqual({ ok: true, video: expect.objectContaining({ ageRestricted: true, regionBlocked: true }) });
  });

  it("결과 없음은 video=null, 오류·예외는 ok=false", async () => {
    const empty = createYoutubeDataApiProvider("k", (async () => Response.json({ items: [] })) as unknown as typeof fetch);
    expect(await empty.lookup(ID)).toEqual({ ok: true, video: null });
    const quota = createYoutubeDataApiProvider("k", (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch);
    expect(await quota.lookup(ID)).toEqual({ ok: false });
    const down = createYoutubeDataApiProvider("k", (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch);
    expect(await down.lookup(ID)).toEqual({ ok: false });
  });

  it("ISO 8601 기간", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration("bad")).toBe(0);
  });
});

describe("서버 전용 경계", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const src = join(dir, "..", "..");

  it("src/server/youtube의 모든 모듈은 server-only를 먼저 불러온다", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("SUPABASE_SERVICE_ROLE_KEY를 읽는 웹 코드는 server/youtube/service.ts 한 파일뿐이다", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name) && !e.name.includes(".test.") && readFileSync(p, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")) {
          hits.push(p.slice(src.length + 1).replace(/\\/g, "/"));
        }
      }
    };
    walk(src);
    const web = join(src, "..");
    for (const f of readdirSync(web).filter((n) => /\.(ts|mjs|js)$/.test(n))) {
      if (readFileSync(join(web, f), "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")) hits.push(f);
    }
    expect(hits).toEqual(["server/youtube/service.ts"]);
    const service = readFileSync(join(dir, "service.ts"), "utf8");
    expect(service.match(/SUPABASE_SERVICE_ROLE_KEY/g)).toHaveLength(2); // 주석 1 + 읽기 1
    expect(service.match(/\.rpc\(/g)).toHaveLength(1);
    expect(service).toContain('rpc("register_youtube_source"');
  });

  it("클라이언트 컴포넌트·lib는 @/server를 값으로 불러오지 않는다", () => {
    for (const sub of ["components/sources", "lib/storage"]) {
      for (const f of readdirSync(join(src, sub)).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))) {
        const text = readFileSync(join(src, sub, f), "utf8");
        expect(text).not.toMatch(/^import (?!type )[^;]*from "@\/server\//m);
      }
    }
  });
});
