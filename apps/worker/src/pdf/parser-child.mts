// 격리된 하위 프로세스 안에서만 실행한다(sandbox.ts). 바이트는 stdin, 결과는 stdout JSON 한 덩어리.
// 인자: <unpdf 진입 파일 경로> <최대 쪽수> <입력 바이트 상한>. 정규화·스캔 판정은 부모(parser.ts)가 한다.
// 동봉된 pdf.js에는 isEvalSupported 옵션이 없다. 대신 sandbox.ts가 --disallow-code-generation-from-strings로 eval·new Function을 V8 수준에서 막는다.
// 결과: { ok: true, pageCount, pages: string[] } | { ok: false, error: "encrypted_pdf" | "too_many_pages" | "invalid_pdf" | "file_too_large" }
import { pathToFileURL } from "node:url";

// pdf.js 경고가 stdout(JSON)에 섞이지 않게 콘솔 출력을 stderr로 돌린다
console.log = console.info = console.warn = console.debug = (...a: unknown[]) => console.error(...a);

const [unpdfEntry, maxPagesArg, maxInputBytesArg] = process.argv.slice(2);
const maxPages = Number(maxPagesArg);
const maxInputBytes = Number(maxInputBytesArg);

function emit(result: unknown): void {
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
}

// 부모가 이미 상한을 검사하지만, 하위 프로세스도 상한을 넘는 순간 읽기를 끊는다(인자가 없거나 잘못되면 거부)
async function readInput(): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += (chunk as Buffer).length;
    if (total > maxInputBytes) return null;
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const input = await readInput();
if (input === null) {
  process.stdout.write(JSON.stringify({ ok: false, error: "file_too_large" }), () => process.exit(0));
  await new Promise(() => {});
}
const data = input as Uint8Array;

const { getDocumentProxy } = (await import(pathToFileURL(unpdfEntry ?? "").href)) as typeof import("unpdf");

// 실패하면 고정 코드 문자열을 돌려준다
async function open() {
  try {
    return await getDocumentProxy(data, { disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  } catch (e) {
    // 권한 거부는 입력 문제가 아니라 격리 설정 문제이므로 그대로 비정상 종료한다
    for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) {
      if ((x as { code?: string }).code === "ERR_ACCESS_DENIED") throw e;
    }
    return (e as { name?: string }).name === "PasswordException" ? "encrypted_pdf" : "invalid_pdf";
  }
}

const pdf = await open();
if (typeof pdf === "string") {
  emit({ ok: false, error: pdf });
} else if (pdf.numPages > maxPages) {
  emit({ ok: false, error: "too_many_pages" });
} else {
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    pages.push(text);
    page.cleanup();
  }
  emit({ ok: true, pageCount: pages.length, pages });
}
