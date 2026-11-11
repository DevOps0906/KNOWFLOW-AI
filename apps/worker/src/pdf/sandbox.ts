// 신뢰할 수 없는 입력을 다루는 스크립트를 격리된 Node 하위 프로세스로 실행한다(task-011 구현 결정 3·4).
// --permission: fs 읽기는 지정 경로만, 쓰기·자식 프로세스·워커·네트워크(--allow-net 없음)·애드온 금지. 환경 변수는 비운다.
// 입력은 stdin, 결과는 stdout. 시간 초과·OOM·비정상 종료·출력 초과는 재시도해도 같으므로 PermanentError로 닫는다.
import { spawn } from "node:child_process";
import { PermanentError } from "../runner.js";
import { PDF_ERROR_CODES, type PdfErrorCode } from "./settings.js";

export interface SandboxOptions {
  /** fs 읽기를 허용할 파일·디렉터리(실행할 스크립트는 자동 포함) */
  readPaths: string[];
  args?: string[];
  timeoutMs: number;
  maxOldSpaceMb: number;
  maxOutputBytes: number;
  /** 임대 상실 등으로 중단되면 하위 프로세스를 죽이고 신호의 사유로 거부한다(영구 실패가 아니다). */
  signal?: AbortSignal;
}

// OOM 판정에만 쓰고 로그에 남기지 않는다(본문 조각이 섞일 수 있다).
// V8의 OOM 메시지는 종료 직전에 나오므로 앞부분이 아니라 마지막 부분을 남긴다.
const STDERR_KEEP_CHARS = 8 * 1024;
const OOM_PATTERN = /heap out of memory|Reached heap limit|Allocation failed|out of memory/i;
// 우리가 죽이지 않았는데 SIGKILL로 끝났다 = 커널 OOM killer(컨테이너 mem_limit)로 본다
const OOM_SIGNALS = new Set<NodeJS.Signals>(["SIGKILL"]);

/**
 * 하위 프로세스 종료 결과 분류. 성공이면 null.
 * OOM: stderr에 V8 OOM 메시지가 있거나(보통 SIGABRT·SIGTRAP과 함께 끝난다), 외부 SIGKILL로 끝남. 그 밖의 비정상 종료는 parser_crashed.
 */
export function classifyExit(code: number | null, signal: NodeJS.Signals | null, stderrTail: string): PdfErrorCode | null {
  if (code === 0 && signal === null) return null;
  if (OOM_PATTERN.test(stderrTail) || (signal !== null && OOM_SIGNALS.has(signal))) return PDF_ERROR_CODES.parserOutOfMemory;
  return PDF_ERROR_CODES.parserCrashed;
}

/** 네트워크 권한 모델(--allow-net)이 없는 Node에서는 네트워크가 막히지 않으므로 실행하지 않는다. */
export function assertSandboxSupported(): void {
  if (!process.allowedNodeEnvironmentFlags.has("--allow-net")) {
    throw new Error(`이 Node(${process.version})는 --permission으로 네트워크를 막지 못해 파서를 격리할 수 없습니다`);
  }
}

export function sandboxArgs(script: string, opts: Pick<SandboxOptions, "readPaths" | "args" | "maxOldSpaceMb">): string[] {
  return [
    "--permission",
    ...[script, ...opts.readPaths].map((p) => `--allow-fs-read=${p}`),
    `--max-old-space-size=${opts.maxOldSpaceMb}`,
    "--disallow-code-generation-from-strings",
    script,
    ...(opts.args ?? []),
  ];
}

export function runSandboxed(script: string, input: Uint8Array, opts: SandboxOptions): Promise<string> {
  assertSandboxSupported();
  opts.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, sandboxArgs(script, opts), {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let failure: unknown;

    const stop = (reason: unknown) => {
      failure ??= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(new PermanentError(PDF_ERROR_CODES.parserTimeout)), opts.timeoutMs);
    const onAbort = () => stop(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > opts.maxOutputBytes) stop(new PermanentError(PDF_ERROR_CODES.parserOutputTooLarge));
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString("utf8")).slice(-STDERR_KEEP_CHARS);
    });
    // 하위 프로세스가 입력을 다 읽기 전에 죽으면 EPIPE가 난다. 종료 결과로 판정하므로 무시한다.
    child.stdin.on("error", () => {});
    child.on("error", (e) => stop(e));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      // 우리가 죽인 경우(시간 초과·출력 초과·중단)는 그 사유가 우선한다
      if (failure !== undefined) return reject(failure);
      const failed = classifyExit(code, signal, err);
      if (failed === null) return resolve(Buffer.concat(out).toString("utf8"));
      reject(new PermanentError(failed));
    });
    child.stdin.end(input);
  });
}
