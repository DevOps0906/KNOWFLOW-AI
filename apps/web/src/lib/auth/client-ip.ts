import { isIP } from "node:net";

// ADR-0003: 신뢰하는 IP 헤더는 `x-real-ip`(Vercel이 설정) 하나뿐이다.
// `x-forwarded-for` 등 클라이언트가 위조할 수 있는 헤더는 읽지 않는다.
// 헤더가 없으면(로컬 등) null → IP 기준 한도는 건너뛰고 계정·사용자 기준 한도만 적용한다.

function expandIpv6(ip: string): number[] | null {
  let address = ip.split("%")[0]!;
  const dotted = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[2]!.split(".").map(Number);
    const hi = ((parts[0]! << 8) | parts[1]!).toString(16);
    const lo = ((parts[2]! << 8) | parts[3]!).toString(16);
    address = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const numbers = groups.map((g) => parseInt(g, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? numbers : null;
}

export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const raw = headers.get("x-real-ip")?.trim();
  if (!raw) return null;
  const version = isIP(raw);
  if (version === 4) return raw;
  if (version === 6) {
    const groups = expandIpv6(raw);
    if (!groups) return null;
    // IPv4 매핑 주소(::ffff:a.b.c.d)는 IPv4로 취급
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
    }
    // IPv6는 /64 단위로 묶는다(주소 한 개를 바꿔 한도를 피하지 못하도록)
    return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
  }
  return null;
}
