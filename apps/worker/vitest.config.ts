import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts", "docker/**/*.test.mjs"]} });