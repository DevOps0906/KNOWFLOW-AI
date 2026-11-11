// 컨테이너 안에서 도는 네트워크 프로브. verify-egress.mjs가 compose의 probe-* 서비스로 실행한다.
// 모드 control: 격리되지 않은 망에서 외부에 닿아야 한다(이게 실패하면 차단 판정은 무효).
// 모드 isolated: worker와 같은 이미지·UID·권한·망에서 직접 연결은 실패하고 프록시 경유만 허용 범위에서 성공해야 한다.
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

const TIMEOUT_MS = 2500;
const PROXY = { host: "egress-proxy", port: 8888 };

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: TIMEOUT_MS });
    const done = (result) => {
      s.destroy();
      resolve(result);
    };
    s.once("connect", () => done({ connected: true, detail: "connected" }));
    s.once("timeout", () => done({ connected: false, detail: "timeout" }));
    s.once("error", (e) => done({ connected: false, detail: e.code ?? e.name }));
  });
}

// A 레코드 질의 패킷 하나를 UDP로 보내 응답이 오는지 본다
function dnsQuery(server) {
  const name = Buffer.from("\x07example\x03com\x00", "latin1");
  const packet = Buffer.concat([Buffer.from([0x13, 0x37, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), name, Buffer.from([0, 1, 0, 1])]);
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const done = (result) => {
      clearTimeout(timer);
      s.close();
      resolve(result);
    };
    const timer = setTimeout(() => done({ connected: false, detail: "timeout" }), TIMEOUT_MS);
    s.once("error", (e) => done({ connected: false, detail: e.code ?? e.name }));
    s.once("message", () => done({ connected: true, detail: "answered" }));
    s.send(packet, 53, server, (e) => {
      if (e) done({ connected: false, detail: e.code ?? e.name });
    });
  });
}

async function tryLookup(name) {
  try {
    await dns.lookup(name);
    return { connected: true, detail: "resolved" };
  } catch (e) {
    return { connected: false, detail: e.code ?? e.name };
  }
}

async function tryHostname(host, port) {
  const looked = await tryLookup(host);
  if (!looked.connected) return looked;
  return tryConnect(host, port);
}

// 프록시에 CONNECT를 보내고 상태 코드와 터널 소켓을 돌려준다
function proxyConnect(target) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ ...PROXY, timeout: 15_000 });
    let buf = Buffer.alloc(0);
    s.once("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.once("timeout", () => {
      s.destroy();
      reject(new Error("proxy_timeout"));
    });
    s.once("error", reject);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!buf.includes("\r\n\r\n")) return;
      s.off("data", onData);
      s.off("error", reject);
      s.setTimeout(0);
      resolve({ status: Number(buf.toString("latin1").split(" ")[1]), socket: s });
    };
    s.on("data", onData);
  });
}

function tlsHandshake(socket, servername) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername });
    t.setTimeout(10_000, () => {
      t.destroy();
      reject(new Error("tls_timeout"));
    });
    t.once("secureConnect", () => {
      const authorized = t.authorized;
      t.destroy();
      resolve(authorized);
    });
    t.once("error", reject);
  });
}

function rawProxyRequest(request) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ ...PROXY, timeout: 5000 });
    s.once("connect", () => s.write(request));
    s.once("timeout", () => {
      s.destroy();
      reject(new Error("proxy_timeout"));
    });
    s.once("error", reject);
    s.once("data", (chunk) => {
      s.destroy();
      resolve(Number(chunk.toString("latin1").split(" ")[1]));
    });
  });
}

const results = [];
function record(kind, name, pass, detail) {
  results.push({ kind, name, pass, detail });
}

async function expectBlocked(name, attempt) {
  const r = await attempt;
  record("차단", name, !r.connected, r.detail);
}

async function expectConnected(name, attempt) {
  const r = await attempt;
  record("성공", name, r.connected, r.detail);
}

async function expectProxyDenied(target, status) {
  try {
    const r = await proxyConnect(target);
    r.socket.destroy();
    record("프록시 거부", target, r.status === status, `HTTP ${r.status}`);
  } catch (e) {
    record("프록시 거부", target, false, e.message);
  }
}

async function runControl() {
  await Promise.all([
    expectConnected("직접 1.1.1.1:443", tryConnect("1.1.1.1", 443)),
    expectConnected("직접 8.8.8.8:443", tryConnect("8.8.8.8", 443)),
    expectConnected("DNS 직접 1.1.1.1:53", dnsQuery("1.1.1.1")),
    expectConnected("이름 해석 example.com", tryLookup("example.com")),
  ]);
}

function assertSandbox() {
  const status = readFileSync("/proc/self/status", "utf8");
  const capEff = /^CapEff:\s*([0-9a-f]+)/m.exec(status)?.[1];
  const noNewPrivs = /^NoNewPrivs:\s*(\d)/m.exec(status)?.[1];
  record("권한", `uid=${process.getuid()}`, process.getuid() !== 0, "non-root");
  record("권한", "CapEff=0", /^0+$/.test(capEff ?? "x"), capEff);
  record("권한", "NoNewPrivs=1", noNewPrivs === "1", noNewPrivs);
}

async function runIsolated() {
  assertSandbox();

  const gateways = (process.env.PROBE_GATEWAYS ?? "").split(",").filter(Boolean);
  const hostPorts = (process.env.PROBE_HOST_PORTS ?? "").split(",").filter(Boolean).map(Number);
  const gatewayPorts = [...new Set([22, 53, 80, 443, 2375, 2376, 5432, ...hostPorts])];
  console.log(`게이트웨이 검사 범위: 지정 포트 ${gatewayPorts.length}개만 확인(전체 포트 아님) — ${gatewayPorts.join(", ")}`);

  const direct = [
    ["169.254.169.254", 80], ["10.0.0.1", 80], ["172.16.0.1", 80], ["192.168.0.1", 80],
    ["1.1.1.1", 443], ["8.8.8.8", 443],
    ["::1", 80], ["fd00::1", 80], ["fc00::1", 80], ["fd00:ec2::254", 80],
    ["192.168.65.1", 80], ["192.168.65.2", 80], ["192.168.65.254", 80], ["192.168.65.7", 80],
  ];
  await Promise.all([
    ...direct.map(([h, p]) => expectBlocked(`직접 ${h}:${p}`, tryConnect(h, p))),
    ...gateways.flatMap((gw) => gatewayPorts.map((p) => expectBlocked(`게이트웨이 ${gw}:${p}`, tryConnect(gw, p)))),
    expectBlocked("host.docker.internal:80", tryHostname("host.docker.internal", 80)),
    expectBlocked("gateway.docker.internal:80", tryHostname("gateway.docker.internal", 80)),
    expectBlocked("DNS 직접 1.1.1.1:53", dnsQuery("1.1.1.1")),
    expectBlocked("DNS 직접 8.8.8.8:53", dnsQuery("8.8.8.8")),
    expectBlocked("외부 이름 해석 example.com", tryLookup("example.com")),
    expectConnected("내부망 직접 db:5432", tryConnect("db", 5432)),
  ]);

  await Promise.all([
    expectProxyDenied("example.com:443", 403),
    expectProxyDenied("api.anthropic.com:80", 403),
    expectProxyDenied("169.254.169.254:80", 403),
    expectProxyDenied("1.1.1.1:443", 403),
    expectProxyDenied("[fd00:ec2::254]:80", 403),
    expectProxyDenied("db:5432", 403),
    expectProxyDenied("host.docker.internal:80", 403),
  ]);

  try {
    const status = await rawProxyRequest("GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n");
    record("프록시 거부", "CONNECT 외 메서드(GET)", status === 405, `HTTP ${status}`);
  } catch (e) {
    record("프록시 거부", "CONNECT 외 메서드(GET)", false, e.message);
  }

  try {
    const r = await proxyConnect("api.anthropic.com:443");
    if (r.status !== 200) {
      r.socket.destroy();
      record("프록시 허용", "api.anthropic.com:443 TLS", false, `HTTP ${r.status}`);
    } else {
      const authorized = await tlsHandshake(r.socket, "api.anthropic.com");
      record("프록시 허용", "api.anthropic.com:443 TLS", authorized, `인증서 검증=${authorized}`);
    }
  } catch (e) {
    record("프록시 허용", "api.anthropic.com:443 TLS", false, e.message);
  }

  // NODE_USE_ENV_PROXY=1 이면 fetch가 프록시를 탄다
  const viaFetch = async (name, url, isExpected) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      record("fetch", name, isExpected(res.status), `HTTP ${res.status}`);
    } catch (e) {
      record("fetch", name, isExpected(null), `요청 실패 ${e.cause?.code ?? e.cause?.message ?? e.name}`);
    }
  };
  await Promise.all([
    // TLS 터널 안의 응답이라 프록시가 만든 상태 코드일 수 없다. 키가 없어 4xx가 정상이다.
    viaFetch("허용 https://api.anthropic.com/ (키 없음)", "https://api.anthropic.com/", (s) => s !== null && s < 500),
    viaFetch("내부망 http://embedding-stub:8080/health", "http://embedding-stub:8080/health", (s) => s === 200),
    viaFetch("거부 https://example.com/", "https://example.com/", (s) => s === null),
  ]);
}

const mode = process.argv[2];
if (mode === "control") await runControl();
else if (mode === "isolated") await runIsolated();
else throw new Error("모드는 control 또는 isolated");

for (const r of results) console.log(`${r.pass ? "통과" : "실패"} [${r.kind}] ${r.name} — ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`합계 ${results.length}건, 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
