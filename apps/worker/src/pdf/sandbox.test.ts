import { readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermanentError } from "../runner.js";
import { classifyExit, runSandboxed } from "./sandbox.js";
import { PDF_ERROR_CODES } from "./settings.js";

// 격리 하위 프로세스가 실제로 탈출을 시도해 실패하는지 본다. Docker 안 검증은 scripts/verify-parser-sandbox.mjs.
const PROBE = fileURLToPath(new URL("../../scripts/parser-sandbox-probe.mjs", import.meta.url));
const READABLE = fileURLToPath(new URL("../../package.json", import.meta.url));
const WINDOWS_REQUIRED_ENV = new Set(["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"]);
const LIMITS ={ readPaths: [], timeoutMs: 20_000, maxOldSpaceMb: 64, maxOutputBytes: 1024 * 1024 };

let server: net.Server;
let port = 0;

beforeAll(async () => {
  server = net.createServer((s) => s.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function probe(targets: object) {
  return JSON.parse(await runSandboxed(PROBE, new Uint8Array(), { ...LIMITS, args: ["probe", JSON.stringify(targets)] })) as {
    envKeys: string[];
    files: Record<string, string>;
    tcp: Record<string, string>;
    dns: Record<string, string>;
    udp: Record<string, string>;
    fetch: Record<string, string>;
    codegen: Record<string, string>;
  };
}

describe("runSandboxed 격리", () => {
  it("부모 환경 변수(비밀)를 넘기지 않는다", async () => {
    process.env.KF_SANDBOX_TEST_SECRET = "must-not-leak";
    try {
      const keys = (await probe({})).envKeys;
      // Windows의 libuv는 프로세스 기동에 필요한 시스템 변수만 강제로 채운다(비밀 아님). Linux(운영 컨테이너)는 비어 있어야 한다.
      if (process.platform === "win32") expect(keys.every((k) => WINDOWS_REQUIRED_ENV.has(k.toUpperCase()))).toBe(true);
      else expect(keys).toEqual([]);
    } finally {
      delete process.env.KF_SANDBOX_TEST_SECRET;
    }
  });

  it("허용하지 않은 파일·/proc environ 읽기가 거부된다", async () => {
    expect(readFileSync(READABLE).length).toBeGreaterThan(0); // 대조: 부모는 읽을 수 있다
    const files = [READABLE, ...(process.platform === "linux" ? ["/proc/1/environ", "/proc/self/environ"] : [])];
    const r = await probe({ files });
    for (const f of files) expect(r.files[f], f).toBe("ERR_ACCESS_DENIED");
  });

  it("TCP·UDP·DNS·fetch가 모두 거부된다(대조: 부모는 같은 TCP에 붙는다)", async () => {
    await new Promise<void>((resolve, reject) => net.connect(port, "127.0.0.1").once("connect", function (this: net.Socket) {
      this.destroy();
      resolve();
    }).once("error", reject));
    const r = await probe({ tcp: [["127.0.0.1", port]], udp: [["127.0.0.1", port]], dns: ["example.com"], fetch: [`http://127.0.0.1:${port}/`] });
    expect(r.tcp[`127.0.0.1:${port}`]).toBe("ERR_ACCESS_DENIED");
    expect(r.udp[`127.0.0.1:${port}`]).toBe("ERR_ACCESS_DENIED");
    expect(r.dns["lookup:example.com"]).toBe("ERR_ACCESS_DENIED");
    expect(r.dns["resolve4:example.com"]).toBe("ERR_ACCESS_DENIED");
    expect(r.fetch[`http://127.0.0.1:${port}/`]).not.toBe("ok");
  });

  it("문자열 코드 생성(eval·new Function)이 막힌다", async () => {
    expect((await probe({})).codegen).toEqual({ eval: "EvalError", newFunction: "EvalError" });
  });

  it("비정상 종료는 parser_crashed", async () => {
    const e = await runSandboxed(PROBE, new Uint8Array(), { ...LIMITS, args: ["crash"] }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PermanentError);
    expect((e as PermanentError).code).toBe(PDF_ERROR_CODES.parserCrashed);
  });

  it("메모리 초과는 parser_out_of_memory", async () => {
    const e = await runSandboxed(PROBE, new Uint8Array(), { ...LIMITS, maxOldSpaceMb: 16, args: ["oom"] }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PermanentError);
    expect((e as PermanentError).code).toBe(PDF_ERROR_CODES.parserOutOfMemory);
  });
});

describe("classifyExit 종료 분류", () => {
  it("정상 종료만 성공, 나머지는 고정 코드", () => {
    expect(classifyExit(0, null, "")).toBeNull();
    // V8 OOM 메시지(보통 SIGABRT·SIGTRAP과 함께)
    const v8 = "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    expect(classifyExit(null, "SIGABRT", v8)).toBe(PDF_ERROR_CODES.parserOutOfMemory);
    expect(classifyExit(null, "SIGTRAP", v8)).toBe(PDF_ERROR_CODES.parserOutOfMemory);
    expect(classifyExit(134, null, v8)).toBe(PDF_ERROR_CODES.parserOutOfMemory);
    // 우리가 죽이지 않은 SIGKILL = 커널 OOM killer
    expect(classifyExit(null, "SIGKILL", "")).toBe(PDF_ERROR_CODES.parserOutOfMemory);
    // 그 밖의 비정상 종료
    expect(classifyExit(null, "SIGABRT", "")).toBe(PDF_ERROR_CODES.parserCrashed);
    expect(classifyExit(null, "SIGSEGV", "")).toBe(PDF_ERROR_CODES.parserCrashed);
    expect(classifyExit(1, null, "Error: boom")).toBe(PDF_ERROR_CODES.parserCrashed);
    // 종료 코드 0이어도 신호가 있으면 성공이 아니다
    expect(classifyExit(0, "SIGTERM", "")).toBe(PDF_ERROR_CODES.parserCrashed);
  });
});
