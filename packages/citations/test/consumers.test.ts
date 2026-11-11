import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));

// web·worker 의존 선언이 빠지면 여기서 실패한다(각 앱 node_modules 기준으로 해석)
describe.each(["web", "worker"])("%s에서 소비", (app) => {
  it("워크스페이스 패키지를 해석해 실행한다", async () => {
    const require = createRequire(new URL(`../../../apps/${app}/package.json`, import.meta.url));
    const resolved = realpathSync(require.resolve("citations"));
    expect(resolved).toBe(realpathSync(entry));

    const mod = (await import(/* @vite-ignore */ pathToFileURL(resolved).href)) as typeof import("../src/index.js");
    expect(mod.verifyCitations({ cited: [], allowedChunks: [] }).status).toBe("none");
  });
});
