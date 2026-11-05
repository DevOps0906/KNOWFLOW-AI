import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 큐 테스트(claim_job)가 전역 큐를 건드리므로 파일은 순서대로 실행한다
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
