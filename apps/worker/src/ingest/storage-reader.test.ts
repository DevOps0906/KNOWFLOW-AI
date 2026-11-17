import { describe, expect, it } from "vitest";
import { PermanentError } from "../runner.js";
import { INGEST_ERROR_CODES } from "./settings.js";
import { createStorageSourceReader } from "./source-reader.js";

const URL_BASE = "http://127.0.0.1:54321";
const KEY = "service-s3cret";

type Call = { url: string; init: RequestInit };

function reader(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, extra: { maxBytes?: number; headerTimeoutMs?: number; bodyTimeoutMs?: number } = {}) {
  const calls: Call[] = [];
  const r = createStorageSourceReader({
    url: URL_BASE,
    serviceRoleKey: KEY,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    }) as typeof fetch,
    ...extra,
  });
  return { r, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 청크를 차례로 내보내는 스트림. cancel 여부를 기록한다 */
function streamOf(chunks: Uint8Array[], state: { cancelled: boolean } = { cancelled: false }) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]!);
      else c.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
}

/** signal이 중단될 때까지 끝나지 않는 fetch */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));

async function codeOf(p: Promise<unknown>): Promise<{ permanent: boolean; code: string }> {
  try {
    await p;
  } catch (e) {
    return { permanent: e instanceof PermanentError, code: e instanceof PermanentError ? e.code : (e as Error).message };
  }
  throw new Error("예외가 나지 않았습니다");
}

describe("createStorageSourceReader · 요청", () => {
  it("authenticated 경로·서비스 키 헤더·redirect error로 GET 하고 200 본문을 돌려준다", async () => {
    const { r, calls } = reader(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    expect(Array.from(await r.read("user-1/src_1/a.pdf"))).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${URL_BASE}/storage/v1/object/authenticated/sources/user-1/src_1/a.pdf`);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h).toEqual({ Authorization: `Bearer ${KEY}`, apikey: KEY });
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("경로 이상은 요청 없이 source_path_invalid", async () => {
    const { r, calls } = reader(async () => new Response("x"));
    for (const p of ["../etc/passwd", "a//b", "/abs", "a/%2e%2e", "a\\b", "a/b?x=1"]) {
      expect(await codeOf(r.read(p))).toEqual({ permanent: true, code: INGEST_ERROR_CODES.sourcePathInvalid });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("createStorageSourceReader · 응답 분류", () => {
  const missing = { permanent: true, code: INGEST_ERROR_CODES.sourceObjectMissing };

  it("404는 객체 없음(영구)", async () => {
    expect(await codeOf(reader(async () => new Response("", { status: 404 })).r.read("u/a.pdf"))).toEqual(missing);
    expect(await codeOf(reader(async () => json(404, { statusCode: "404", error: "not_found", message: "Object not found" })).r.read("u/a.pdf"))).toEqual(missing);
  });

  it("400인데 본문이 statusCode 404·not_found면 객체 없음(영구)", async () => {
    expect(await codeOf(reader(async () => json(400, { statusCode: "404", error: "not_found", message: "Object not found" })).r.read("u/a.pdf"))).toEqual(missing);
    expect(await codeOf(reader(async () => json(400, { statusCode: "400", error: "NotFound" })).r.read("u/a.pdf"))).toEqual(missing);
  });

  it("버킷 없음·Invalid JWT·그 밖 400은 재시도(일반 Error)", async () => {
    for (const body of [
      { statusCode: "404", error: "Bucket not found", message: "Bucket not found" },
      { statusCode: "400", error: "Unauthorized", message: "Invalid JWT" },
      { statusCode: "400", error: "invalid_request" },
    ]) {
      const got = await codeOf(reader(async () => json(400, body)).r.read("u/a.pdf"));
      expect(got.permanent).toBe(false);
    }
    expect((await codeOf(reader(async () => new Response("not json", { status: 400 })).r.read("u/a.pdf"))).permanent).toBe(false);
    expect((await codeOf(reader(async () => json(404, { error: "Bucket not found" })).r.read("u/a.pdf"))).permanent).toBe(false);
  });

  it("오류 본문은 4KB까지만 읽는다(넘으면 분류하지 않고 재시도)", async () => {
    const state = { cancelled: false };
    const big = new TextEncoder().encode(JSON.stringify({ statusCode: "404", error: "not_found", pad: "x".repeat(10_000) }));
    const got = await codeOf(reader(async () => new Response(streamOf([big.slice(0, 3000), big.slice(3000, 6000), big.slice(6000)], state), { status: 400 })).r.read("u/a.pdf"));
    expect(got.permanent).toBe(false);
    expect(state.cancelled).toBe(true);
  });

  it("401·403·429·5xx·기타 4xx·네트워크 오류는 재시도이고 메시지에 키·URL이 없다", async () => {
    for (const status of [401, 403, 409, 429, 500, 502, 503, 206, 204]) {
      const got = await codeOf(reader(async () => new Response(status === 204 ? null : "x", { status })).r.read("u/a.pdf"));
      expect(got).toEqual({ permanent: false, code: `storage_http_${status}` });
    }
    const net = await codeOf(reader(async () => { throw new TypeError(`fetch failed ${KEY} ${URL_BASE}`); }).r.read("u/a.pdf"));
    expect(net).toEqual({ permanent: false, code: "storage_network_error" });
    expect(net.code).not.toContain(KEY);
  });
});

describe("createStorageSourceReader · 상한", () => {
  const tooLarge = { permanent: true, code: INGEST_ERROR_CODES.sourceTooLarge };

  it("content-length가 상한을 넘으면 본문을 읽지 않고 영구 실패", async () => {
    const state = { cancelled: false };
    const res = new Response(streamOf([new Uint8Array(4)], state), { status: 200, headers: { "content-length": "11" } });
    expect(await codeOf(reader(async () => res, { maxBytes: 10 }).r.read("u/a.pdf"))).toEqual(tooLarge);
    expect(state.cancelled).toBe(true);
  });

  it("스트리밍 누적이 상한을 넘으면 중단하고 영구 실패", async () => {
    const state = { cancelled: false };
    const res = new Response(streamOf([new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)], state), { status: 200 });
    expect(await codeOf(reader(async () => res, { maxBytes: 10 }).r.read("u/a.pdf"))).toEqual(tooLarge);
    expect(state.cancelled).toBe(true);
  });

  it("상한과 같은 크기는 허용하고 여러 청크를 이어 붙인다", async () => {
    const res = new Response(streamOf([new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array([6, 7, 8, 9, 10])]), { status: 200 });
    expect(Array.from(await reader(async () => res, { maxBytes: 10 }).r.read("u/a.pdf"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("createStorageSourceReader · 시간 초과·중단", () => {
  it("헤더 시간 초과는 재시도(일반 Error)", async () => {
    expect(await codeOf(reader(hang, { headerTimeoutMs: 20, bodyTimeoutMs: 1000 }).r.read("u/a.pdf"))).toEqual({ permanent: false, code: "storage_timeout" });
  });

  it("본문 전체 시간 초과는 재시도(일반 Error)", async () => {
    const slowBody = (init: RequestInit) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(1));
          init.signal!.addEventListener("abort", () => c.error(init.signal!.reason), { once: true });
        },
      });
    const { r } = reader(async (_u, init) => new Response(slowBody(init), { status: 200 }), { headerTimeoutMs: 1000, bodyTimeoutMs: 30 });
    expect(await codeOf(r.read("u/a.pdf"))).toEqual({ permanent: false, code: "storage_timeout" });
  });

  it("헤더가 오면 헤더 타이머는 멈춘다(본문 한도 안이면 성공)", async () => {
    const { r } = reader(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(c) {
              await new Promise((resolve) => setTimeout(resolve, 40));
              c.enqueue(new Uint8Array([7]));
              c.close();
            },
          }),
          { status: 200 },
        ),
      { headerTimeoutMs: 20, bodyTimeoutMs: 1000 },
    );
    expect(Array.from(await r.read("u/a.pdf"))).toEqual([7]);
  });

  it("작업 signal 중단은 시간 초과로 바꾸지 않고 그대로 전파한다", async () => {
    const ac = new AbortController();
    const reason = new Error("lease lost");
    const p = reader(hang, { headerTimeoutMs: 1000, bodyTimeoutMs: 1000 }).r.read("u/a.pdf", ac.signal);
    setTimeout(() => ac.abort(reason), 10);
    await expect(p).rejects.toBe(reason);
    const pre = new AbortController();
    pre.abort(reason);
    const { r, calls } = reader(hang);
    await expect(r.read("u/a.pdf", pre.signal)).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });
});
