// Worker 소스(.ts)를 평가 스크립트에서 그대로 쓰기 위한 로더 훅. Worker가 이미 쓰는 typescript로 변환한다(새 의존성 없음).
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ts = createRequire(new URL("../apps/worker/package.json", import.meta.url))("typescript");

registerHooks({
  resolve(specifier, context, next) {
    // Worker 소스는 "./x.js"로 서로를 가져온다(NodeNext). 같은 이름의 .ts가 있으면 그쪽으로.
    if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && specifier.endsWith(".js")) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) return next(tsUrl.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: false },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
