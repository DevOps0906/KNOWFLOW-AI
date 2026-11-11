// PDF 바이트 → 쪽별 정규화 텍스트(task-011 구현 결정 2~7). 파싱은 격리된 하위 프로세스(sandbox.ts)에서만 한다.
// 실패는 모두 PermanentError(PDF_ERROR_CODES의 고정 코드). 본문은 로그에 남기지 않는다.
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PermanentError } from "../runner.js";
import { runSandboxed } from "./sandbox.js";
import { PARSER_LIMITS, PDF_ERROR_CODES, PDF_SETTINGS } from "./settings.js";
import { isTextPage, normalizeText } from "./text.js";

export interface PdfPage {
  /** 1부터 시작하는 원본 쪽 번호(건너뛴 쪽이 있어도 원본 번호를 유지한다) */
  page: number;
  text: string;
}

export interface ParsedPdf {
  pageCount: number;
  /** 색인할 텍스트 쪽만 */
  pages: PdfPage[];
  /** 스캔·깨진 텍스트로 판정해 건너뛴 쪽 번호 */
  skippedPages: number[];
}

export interface ParsePdfOptions {
  signal?: AbortSignal;
  limits?: Partial<Record<keyof typeof PARSER_LIMITS, number>>;
  settings?: typeof PDF_SETTINGS;
}

const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const CHILD_ERRORS = new Set<string>([
  PDF_ERROR_CODES.encryptedPdf,
  PDF_ERROR_CODES.tooManyPages,
  PDF_ERROR_CODES.invalidPdf,
  PDF_ERROR_CODES.fileTooLarge,
]);

// 빌드(dist)에서는 .mjs, 소스(테스트)에서는 Node 타입 제거로 .mts를 그대로 실행한다
const CHILD_SCRIPT = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./parser-child.mts" : "./parser-child.mjs", import.meta.url));

let unpdfPaths: { entry: string; dir: string } | undefined;
// 하위 프로세스는 unpdf 패키지 루트만 읽을 수 있다(pnpm 심볼릭 링크를 풀어 실제 경로로 허용한다).
// unpdf가 내장 pdf.js를 자기 패키지 이름으로 불러오므로 package.json이 있는 루트를 허용해야 한다.
function unpdf() {
  if (!unpdfPaths) {
    const entry = realpathSync(fileURLToPath(import.meta.resolve("unpdf")));
    let dir = path.dirname(entry);
    while (!existsSync(path.join(dir, "package.json"))) {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error("unpdf 패키지 루트를 찾지 못했습니다");
      dir = parent;
    }
    unpdfPaths = { entry, dir };
  }
  return unpdfPaths;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ChildResult = { ok: true; pageCount: number; pages: string[] } | { ok: false; error: string };

function parseChildOutput(stdout: string): ChildResult {
  let r: unknown;
  try {
    r = JSON.parse(stdout);
  } catch {
    throw new PermanentError(PDF_ERROR_CODES.parserCrashed);
  }
  const o = r as Partial<{ ok: boolean; error: unknown; pageCount: unknown; pages: unknown }>;
  if (o?.ok === false && typeof o.error === "string" && CHILD_ERRORS.has(o.error)) return { ok: false, error: o.error };
  if (o?.ok === true && Array.isArray(o.pages) && o.pages.every((p) => typeof p === "string") && o.pageCount === o.pages.length) {
    return { ok: true, pageCount: o.pageCount, pages: o.pages as string[] };
  }
  throw new PermanentError(PDF_ERROR_CODES.parserCrashed);
}

export async function parsePdf(bytes: Uint8Array, expectedHash: string, opts: ParsePdfOptions = {}): Promise<ParsedPdf> {
  const limits = { ...PARSER_LIMITS, ...opts.limits };
  // 크기 상한은 해시 계산보다 먼저 본다(큰 입력에 CPU를 쓰지 않는다)
  if (bytes.length > limits.maxInputBytes) throw new PermanentError(PDF_ERROR_CODES.fileTooLarge);
  if (sha256Hex(bytes) !== expectedHash.toLowerCase()) throw new PermanentError(PDF_ERROR_CODES.contentHashMismatch);
  if (bytes.length < PDF_MAGIC.length || !PDF_MAGIC.equals(Buffer.from(bytes.subarray(0, PDF_MAGIC.length)))) {
    throw new PermanentError(PDF_ERROR_CODES.invalidPdf);
  }
  const settings = opts.settings ?? PDF_SETTINGS;
  const { entry, dir } = unpdf();
  const stdout = await runSandboxed(CHILD_SCRIPT, bytes, {
    readPaths: [dir],
    args: [entry, String(settings.maxPages), String(limits.maxInputBytes)],
    timeoutMs: limits.timeoutMs,
    maxOldSpaceMb: limits.maxOldSpaceMb,
    maxOutputBytes: limits.maxOutputBytes,
    signal: opts.signal,
  });
  const result = parseChildOutput(stdout);
  if (!result.ok) throw new PermanentError(result.error);

  const pages: PdfPage[] = [];
  const skippedPages: number[] = [];
  result.pages.forEach((raw, i) => {
    const text = normalizeText(raw);
    if (isTextPage(text, settings)) pages.push({ page: i + 1, text });
    else skippedPages.push(i + 1);
  });
  if (pages.length === 0 || pages.length / result.pageCount < settings.minTextPageRatio) {
    throw new PermanentError(PDF_ERROR_CODES.scannedPdf);
  }
  return { pageCount: result.pageCount, pages, skippedPages };
}
