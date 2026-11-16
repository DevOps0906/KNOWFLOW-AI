// apps/worker 소스는 "./x.js" 로 import 한다(tsc 규칙). Node가 .ts를 직접 실행할 때 .js → .ts로 되돌려 주는 최소 훅.
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    try {
      return await nextResolve(specifier.slice(0, -3) + ".ts", context);
    } catch {}
  }
  return nextResolve(specifier, context);
}
`));
