// 격리된 하위 프로세스(src/pdf/sandbox.ts) 안에서 실행해 탈출을 실제로 시도하는 프로브. 결과는 stdout JSON.
// 사용: node parser-sandbox-probe.mjs probe '<JSON {files, tcp:[[host,port]], dns:[name]}>' | crash | oom
// 각 시도는 성공하면 "ok", 실패하면 오류 코드를 남긴다. 판정은 호출자(테스트·verify-parser-sandbox)가 한다.
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import net from "node:net";

const TIMEOUT_MS = 2500;
const [mode, rawTargets] = process.argv.slice(2);

const code = (e) => e?.code ?? e?.name ?? "error";

async function attempt(fn) {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return code(e);
  }
}

function tcp(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port, timeout: TIMEOUT_MS });
    s.once("connect", () => {
      s.destroy();
      resolve();
    });
    s.once("timeout", () => {
      s.destroy();
      reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    });
    s.once("error", reject);
  });
}

function udp(host, port) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket("udp4");
    s.once("error", reject);
    s.send(Buffer.from("probe"), port, host, (e) => {
      s.close();
      if (e) reject(e);
      else resolve();
    });
  });
}

if (mode === "crash") process.exit(3);
if (mode === "oom") {
  const keep = [];
  for (;;) keep.push(new Array(1_000_000).fill(keep.length));
}

const targets = JSON.parse(rawTargets ?? "{}");
const result = { envKeys: Object.keys(process.env), files: {}, tcp: {}, dns: {}, udp: {}, fetch: {}, codegen: {} };
result.codegen.eval = await attempt(() => (0, eval)("1"));
result.codegen.newFunction = await attempt(() => new Function("return 1")());
for (const f of targets.files ?? []) result.files[f] = await attempt(() => readFileSync(f));
for (const [host, port] of targets.tcp ?? []) result.tcp[`${host}:${port}`] = await attempt(() => tcp(host, port));
for (const name of targets.dns ?? []) {
  result.dns[`lookup:${name}`] = await attempt(() => dns.lookup(name));
  result.dns[`resolve4:${name}`] = await attempt(() => dns.resolve4(name));
}
for (const [host, port] of targets.udp ?? []) result.udp[`${host}:${port}`] = await attempt(() => udp(host, port));
for (const url of targets.fetch ?? []) result.fetch[url] = await attempt(() => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }));
process.stdout.write(JSON.stringify(result));
