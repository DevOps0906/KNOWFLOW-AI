// 원본 읽기(task-011 구현 결정 10). 로컬은 마운트한 픽스처 폴더에서 storage_path로 읽는다.
// Supabase Storage 어댑터는 실제 Supabase 준비 후 구현한다(지금은 인터페이스만).
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { PermanentError } from "../runner.js";
import { INGEST_ERROR_CODES, SOURCE_MAX_BYTES } from "./settings.js";

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

/** 미구현: 실제 Supabase Storage 준비 후 서명 URL 또는 서비스 키로 읽는다(task-011 확정). */
export function createStorageSourceReader(): SourceReader {
  return {
    async read() {
      throw new Error("Supabase Storage 원본 읽기는 아직 구현되지 않았습니다");
    },
  };
}
