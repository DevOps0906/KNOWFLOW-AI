// 이그레스 프록시의 판단 로직(순수 함수). Node 표준 라이브러리만 쓴다.
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT(100.100.100.200 메타데이터 포함)
  ["127.0.0.0", 8],
  ["168.63.129.16", 32], // Azure 메타데이터
  ["169.254.0.0", 16], // 링크로컬(169.254.169.254 메타데이터 포함)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 96], // 미지정·IPv4 호환
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // ULA(fd00:ec2::254 메타데이터 포함)
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

/** 해석된 IP로 연결하면 안 되면 true. 형식이 이상하면 막는다(fail-closed). */
export function isBlockedAddress(ip) {
  const family = isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function parsePort(text) {
  if (!/^[0-9]{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * 허용 목록 파일을 읽는다. 한 줄에 정확한 `host:port` 하나.
 * 와일드카드·IP 리터럴·잘못된 줄이 있거나 항목이 없으면 기동하지 않는다.
 */
export function parseAllowlist(text) {
  const entries = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    if (/\s/.test(line)) throw new Error("허용 목록 줄 형식이 올바르지 않습니다");
    const sep = line.lastIndexOf(":");
    const host = line.slice(0, sep);
    const port = sep > 0 ? parsePort(line.slice(sep + 1)) : null;
    if (port === null || !HOST.test(host) || isIP(host) !== 0) throw new Error("허용 목록 항목은 정확한 host:port여야 합니다");
    entries.set(`${host}:${port}`, { host, port });
  }
  if (entries.size === 0) throw new Error("허용 목록이 비어 있습니다");
  return entries;
}

/** CONNECT 요청 대상(`host:port`, `[v6]:port`)을 해석한다. 형식이 틀리면 null. */
export function parseConnectTarget(authority) {
  if (typeof authority !== "string") return null;
  const m = /^(?:\[([0-9a-fA-F:.]+)\]|([^\s:[\]/@]+)):([0-9]{1,5})$/.exec(authority);
  if (!m) return null;
  const port = parsePort(m[3]);
  if (port === null) return null;
  const host = (m[1] ?? m[2]).toLowerCase();
  return { host, port, key: `${host}:${port}` };
}

/**
 * 호스트를 해석하고 연결할 IP를 고른다. 해석 결과 중 하나라도 금지 대역이면 전체를 거부한다.
 * 호출자는 돌려받은 IP로 바로 연결해 검사와 연결 사이의 DNS 재바인딩을 막는다.
 */
export async function resolveAllowed(entry, lookup) {
  const addresses = await lookup(entry.host);
  if (addresses.length === 0) return { ok: false, reason: "no_address" };
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, reason: "blocked_address" };
  }
  return { ok: true, address: addresses[0].address };
}
