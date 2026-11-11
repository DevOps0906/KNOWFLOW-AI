// Worker의 유일한 외부 출구. HTTP CONNECT만 받고, 허용 목록의 정확한 host:port로만 터널을 연다.
// 요청 헤더는 읽지도 로그에 남기지도 않는다(인증 값이 지나갈 수 있다).
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { parseAllowlist, parseConnectTarget, resolveAllowed } from "./egress-lib.mjs";

const PORT = Number(process.env.EGRESS_PORT ?? 8888);
const ALLOWLIST_PATH = process.env.EGRESS_ALLOWLIST ?? "/etc/egress/allowlist.txt";
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 600_000;

const allowlist = parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf8"));
const resolveHost = (host) => lookup(host, { all: true, order: "ipv4first" });

function logDecision(outcome, reason, target) {
  console.info(JSON.stringify({ type: "egress", at: new Date().toISOString(), outcome, reason, target: String(target ?? "").slice(0, 200) }));
}

function refuse(client, status, text, reason, target) {
  logDecision("denied", reason, target);
  client.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function handleConnect(req, client, head) {
  client.on("error", () => client.destroy());
  const target = parseConnectTarget(req.url);
  if (!target) return refuse(client, 400, "Bad Request", "bad_target", req.url);
  const entry = allowlist.get(target.key);
  if (!entry) return refuse(client, 403, "Forbidden", "not_allowlisted", target.key);

  let resolved;
  try {
    resolved = await resolveAllowed(entry, resolveHost);
  } catch {
    return refuse(client, 502, "Bad Gateway", "dns_failed", target.key);
  }
  if (!resolved.ok) return refuse(client, 403, "Forbidden", resolved.reason, target.key);

  const upstream = net.connect({ host: resolved.address, port: entry.port, timeout: CONNECT_TIMEOUT_MS });
  let connected = false;
  upstream.once("connect", () => {
    connected = true;
    upstream.setTimeout(IDLE_TIMEOUT_MS);
    client.setTimeout(IDLE_TIMEOUT_MS);
    logDecision("allowed", "tunnel", target.key);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n", () => {
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  const fail = () => {
    if (connected) {
      upstream.destroy();
      client.destroy();
    } else {
      upstream.destroy();
      refuse(client, 502, "Bad Gateway", "connect_failed", target.key);
    }
  };
  upstream.once("timeout", fail);
  upstream.once("error", fail);
  client.once("timeout", fail);
  client.once("close", () => upstream.destroy());
  upstream.once("close", () => client.destroy());
}

const server = http.createServer((_req, res) => {
  res.writeHead(405, { Allow: "CONNECT", Connection: "close", "Content-Length": "0" });
  res.end();
});
server.on("connect", (req, client, head) => {
  handleConnect(req, client, head).catch(() => client.destroy());
});
server.listen(PORT, "0.0.0.0", () => {
  logDecision("started", "listening", `${allowlist.size} entries`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
