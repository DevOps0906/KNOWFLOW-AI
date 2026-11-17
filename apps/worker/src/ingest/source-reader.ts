// 원본 읽기(task-011 구현 결정 10). 로컬은 마운트한 픽스처 폴더에서 storage_path로 읽는다.
// 운영은 Supabase Storage REST(서비스 키, createStorageSourceReader)로 읽는다.
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { PermanentError } from "../runner.js";
import { INGEST_ERROR_CODES, SOURCE_MAX_BYTES, STORAGE_SETTINGS } from "./settings.js";

export interface SourceReader {
  /** storage_path(버킷 안 상대 경로)의 바이트. 경로 이상·없음·상한 초과는 PermanentError */
  read(storagePath: string, signal?: AbortSignal): Promise<Uint8Array>;
}

// 버킷 객체 이름 규칙: 슬래시로 나눈 안전한 조각만(빈 조각·.·..·역슬래시·절대 경로 금지)
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/;

export function assertSafeStoragePath(storagePath: string): string[] {
  const segments = storagePath.split("/");
  if (storagePath.length > 1024 || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) {
    throw new PermanentError(INGEST_ERROR_CODES.sourcePathInvalid);
  }
  return segments;
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function createFixtureSourceReader(rootDir: string, maxBytes: number = SOURCE_MAX_BYTES): SourceReader {
  return {
    async read(storagePath, signal) {
      signal?.throwIfAborted();
      const segments = assertSafeStoragePath(storagePath);
      const root = await realpath(rootDir);
      let real: string;
      try {
        // 심볼릭 링크를 풀어 실제 경로가 루트 밖이면 거부한다
        real = await realpath(path.join(root, ...segments));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new PermanentError(INGEST_ERROR_CODES.sourceObjectMissing);
        throw e;
      }
      if (!isInside(root, real)) throw new PermanentError(INGEST_ERROR_CODES.sourcePathInvalid);
      const fh = await open(real, "r");
      try {
        const st = await fh.stat();
        if (!st.isFile()) throw new PermanentError(INGEST_ERROR_CODES.sourceObjectMissing);
        if (st.size > maxBytes) throw new PermanentError(INGEST_ERROR_CODES.sourceTooLarge);
        // read 한 번이 전부를 돌려준다고 가정하지 않는다: st.size를 채우거나 EOF까지 반복한다
        const buf = Buffer.alloc(st.size);
        let filled = 0;
        while (filled < st.size) {
          signal?.throwIfAborted();
          const { bytesRead } = await fh.read(buf, filled, st.size - filled, filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        signal?.throwIfAborted();
        return new Uint8Array(buf.buffer, buf.byteOffset, filled);
      } finally {
        await fh.close();
      }
    },
  };
}

export interface StorageSourceReaderOptions {
  /** 검증·정규화된 Supabase URL(config.ts parseSupabaseUrl, 끝 슬래시 없음) */
  url: string;
  /** 서비스 키. 로그·오류 메시지에 넣지 않는다 */
  serviceRoleKey: string;
  fetch?: typeof fetch;
  maxBytes?: number;
  headerTimeoutMs?: number;
  bodyTimeoutMs?: number;
}

/** 스트림을 limit 바이트까지만 읽는다. 넘으면 null(읽기 취소). */
async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** 오류 본문(최대 4KB, 로그 금지)을 분류한다. 버킷 없음은 설정 문제이므로 객체 없음과 구분한다. */
async function classifyErrorBody(res: Response): Promise<"missing" | "bucket" | "other"> {
  const head = await readLimited(res.body, STORAGE_SETTINGS.errorBodyMaxBytes);
  if (!head) return "other";
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(head));
  } catch {
    return "other";
  }
  if (!parsed || typeof parsed !== "object") return "other";
  const { statusCode, error, message } = parsed as Record<string, unknown>;
  const words = `${typeof error === "string" ? error : ""} ${typeof message === "string" ? message : ""}`;
  if (/bucket/i.test(words)) return "bucket";
  if (String(statusCode) === "404" || (typeof error === "string" && /^not[_ ]?found$/i.test(error))) return "missing";
  return "other";
}

/**
 * Supabase Storage(버킷 sources)에서 서비스 키로 원본을 읽는다.
 * 200만 성공. 객체 없음·상한 초과는 PermanentError, 인증·한도·서버·네트워크·시간 초과는 일반 Error(재시도).
 * 작업 signal 중단은 그대로 전파한다.
 */
export function createStorageSourceReader(opts: StorageSourceReaderOptions): SourceReader {
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? SOURCE_MAX_BYTES;
  const headerTimeoutMs = opts.headerTimeoutMs ?? STORAGE_SETTINGS.headerTimeoutMs;
  const bodyTimeoutMs = opts.bodyTimeoutMs ?? STORAGE_SETTINGS.bodyTimeoutMs;
  return {
    async read(storagePath, signal) {
      signal?.throwIfAborted();
      const segments = assertSafeStoragePath(storagePath);
      const objectUrl = `${opts.url}/storage/v1/object/authenticated/${STORAGE_SETTINGS.bucket}/${segments.map(encodeURIComponent).join("/")}`;
      const timeout = new AbortController();
      const headerTimer = setTimeout(() => timeout.abort(), headerTimeoutMs);
      const bodyTimer = setTimeout(() => timeout.abort(), bodyTimeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
      // 작업 중단은 원래 사유로, 시간 초과·네트워크 오류는 재시도 가능한 일반 Error로 바꾼다(메시지에 URL·키를 넣지 않는다)
      const rethrow = (e: unknown): never => {
        signal?.throwIfAborted();
        if (e instanceof PermanentError) throw e;
        if (timeout.signal.aborted) throw new Error("storage_timeout");
        throw new Error("storage_network_error");
      };
      try {
        let res: Response;
        try {
          res = await doFetch(objectUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${opts.serviceRoleKey}`, apikey: opts.serviceRoleKey },
            redirect: "error",
            signal: combined,
          });
        } catch (e) {
          return rethrow(e);
        }
        clearTimeout(headerTimer);
        if (res.status !== 200) {
          let missing = false;
          if (res.status === 400 || res.status === 404) {
            try {
              const kind = await classifyErrorBody(res);
              // 404는 객체 없음(버킷 없음 제외), 400은 본문이 객체 없음을 말할 때만
              missing = res.status === 404 ? kind !== "bucket" : kind === "missing";
            } catch (e) {
              return rethrow(e);
            }
          }
          await res.body?.cancel().catch(() => {});
          if (missing) throw new PermanentError(INGEST_ERROR_CODES.sourceObjectMissing);
          throw new Error(`storage_http_${res.status}`);
        }
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
          await res.body?.cancel().catch(() => {});
          throw new PermanentError(INGEST_ERROR_CODES.sourceTooLarge);
        }
        let bytes: Uint8Array | null;
        try {
          bytes = await readLimited(res.body, maxBytes);
        } catch (e) {
          return rethrow(e);
        }
        if (!bytes) throw new PermanentError(INGEST_ERROR_CODES.sourceTooLarge);
        signal?.throwIfAborted();
        return bytes;
      } finally {
        clearTimeout(headerTimer);
        clearTimeout(bodyTimer);
      }
    },
  };
}
