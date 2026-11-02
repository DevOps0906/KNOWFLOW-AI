// 사용: node scripts/dev/mshot.mjs <url> <out.png> [width=375] [height=812] — 의존성 없음(Node 내장 fetch·WebSocket)
// headless 창 최소 폭 제한을 피하려고 CDP 기기 에뮬레이션으로 캡처한다.
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, out, w = "375", h = "812"] = process.argv.slice(2);
const cands = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const bin = cands.find(existsSync);
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), "mshot-"));
const ch = spawn(bin, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === "page"); } catch {} await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 768 });
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(4000);
const sw = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth", returnByValue: true });
const { data } = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(data, "base64"));
console.log(`saved ${out} viewport=${w} scrollWidth=${sw.result.value} overflow=${sw.result.value > +w}`);
ws.close(); ch.kill();
process.exit(0);
