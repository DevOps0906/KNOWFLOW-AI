const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSafeToReset(url: string, allowReset: string | undefined): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("TEST_DATABASE_URL은 loopback 호스트만 사용할 수 있습니다.");
  }
  if (allowReset !== "1") {
    throw new Error("스키마 전체 삭제를 허용하려면 DB_TESTS_ALLOW_RESET=1을 명시해야 합니다.");
  }
}
