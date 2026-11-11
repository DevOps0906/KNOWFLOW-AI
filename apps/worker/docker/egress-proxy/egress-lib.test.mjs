import { describe, expect, it, vi } from "vitest";
import { isBlockedAddress, parseAllowlist, parseConnectTarget, resolveAllowed } from "./egress-lib.mjs";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.65.254", "169.254.169.254",
    "100.100.100.200", "168.63.129.16", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd00:ec2::254", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1",
    "not-an-ip", "",
  ])("금지: %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "160.79.104.10", "2606:4700:4700::1111", "::ffff:1.1.1.1"])("허용: %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("정확한 host:port를 읽고 주석·빈 줄을 건너뛴다", () => {
    const list = parseAllowlist("# 주석\n\napi.anthropic.com:443\r\nexample.org:8443 # 예시\n");
    expect([...list.keys()]).toEqual(["api.anthropic.com:443", "example.org:8443"]);
  });

  it.each([
    "*.anthropic.com:443", "api.anthropic.com", "api.anthropic.com:*", "api.anthropic.com:0", "api.anthropic.com:70000",
    "1.1.1.1:443", "[::1]:443", "API.anthropic.com:443", "internal embedding-stub:8080", "a b c", ":443",
  ])("거부: %s", (line) => {
    expect(() => parseAllowlist(line)).toThrow();
  });

  it("항목이 없으면 기동하지 않는다", () => {
    expect(() => parseAllowlist("# 비어 있음\n")).toThrow(/비어/);
  });
});

describe("parseConnectTarget", () => {
  it("host:port와 [v6]:port를 해석하고 소문자로 맞춘다", () => {
    expect(parseConnectTarget("API.Anthropic.com:443")).toEqual({ host: "api.anthropic.com", port: 443, key: "api.anthropic.com:443" });
    expect(parseConnectTarget("[fd00:ec2::254]:80")).toMatchObject({ host: "fd00:ec2::254", port: 80 });
  });

  it.each([undefined, "", "example.com", "example.com:", "example.com:99999", "http://example.com:80", "user@example.com:443", "a:b:c", "exa mple:80"])(
    "거부: %s",
    (authority) => {
      expect(parseConnectTarget(authority)).toBeNull();
    },
  );
});

describe("resolveAllowed", () => {
  const entry = { host: "api.anthropic.com", port: 443 };

  it("공인 주소면 연결할 IP를 돌려준다", async () => {
    const lookup = vi.fn(async () => [{ address: "160.79.104.10", family: 4 }]);
    await expect(resolveAllowed(entry, lookup)).resolves.toEqual({ ok: true, address: "160.79.104.10" });
  });

  it("허용된 호스트라도 해석 결과에 금지 대역이 하나라도 있으면 거부한다(DNS 재바인딩)", async () => {
    const lookup = async () => [{ address: "160.79.104.10", family: 4 }, { address: "169.254.169.254", family: 4 }];
    await expect(resolveAllowed(entry, lookup)).resolves.toEqual({ ok: false, reason: "blocked_address" });
  });

  it("사설 IP로 해석되면 거부한다", async () => {
    const lookup = async () => [{ address: "172.20.0.3", family: 4 }];
    await expect(resolveAllowed(entry, lookup)).resolves.toMatchObject({ ok: false });
  });

  it("해석 결과가 없으면 거부한다", async () => {
    await expect(resolveAllowed(entry, async () => [])).resolves.toEqual({ ok: false, reason: "no_address" });
  });
});
