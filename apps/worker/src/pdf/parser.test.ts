import { describe, expect, it } from "vitest";
import { PermanentError } from "../runner.js";
import { fileURLToPath } from "node:url";
import { parsePdf, sha256Hex } from "./parser.js";
import { runSandboxed } from "./sandbox.js";
import { PDF_ERROR_CODES } from "./settings.js";
import { countChars, isTextPage, normalizeText } from "./text.js";

// 테스트용 PDF를 직접 만든다. 글꼴은 Identity-H + ToUnicode(코드=UTF-16 코드 단위)라 한국어 텍스트가 그대로 추출된다.
// page가 null이면 텍스트 없이 선만 그린 쪽(스캔 쪽 대용)이다.
function makePdf(pages: (string[] | null)[], opts: { encrypted?: boolean; shareContent?: boolean } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) as number;
  const stream = (dict: string, data: string) => `<< ${dict} /Length ${Buffer.byteLength(data, "latin1")} >>\nstream\n${data}\nendstream`;
  const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /KF-UCS def /CMapType 2 def",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    "1 beginbfrange <0000> <FFFF> <0000> endbfrange",
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
  const toUnicode = add(stream("", cmap));
  const descriptor = add("<< /Type /FontDescriptor /FontName /KFTest /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>");
  const cidFont = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KFTest /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /DW 1000 >>`,
  );
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /KFTest /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`);

  const content = (lines: string[] | null) =>
    lines === null
      ? "0 0 m 200 200 l S"
      : `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `<${hex(l)}> Tj T*`).join(" ")} ET`;
  let shared: number | undefined;
  const kids = pages.map((lines) => {
    const c = opts.shareContent ? (shared ??= add(stream("", content(lines)))) : add(stream("", content(lines)));
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  // 사용자 암호가 비어 있지 않은 표준 보안 처리기(R2). O·U 값이 임의라 빈 암호로는 열리지 않는다.
  const encrypt = opts.encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /O <${"11".repeat(32)}> /U <${"22".repeat(32)}> /P -4 >>`) : undefined;

  let out = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
  const offsets = objs.map((body, i) => {
    const at = Buffer.byteLength(out, "latin1");
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  const id = `<${"ab".repeat(16)}>`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R /ID [${id} ${id}]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(PermanentError);
  expect((e as PermanentError).code).toBe(code);
}

const parse = (bytes: Uint8Array, opts?: Parameters<typeof parsePdf>[2]) => parsePdf(bytes, sha256Hex(bytes), opts);

describe("parsePdf", () => {
  it("한국어 텍스트 PDF를 쪽 번호와 함께 추출한다", async () => {
    const pdf = makePdf([["지식 관리 서비스 KnowFlow 소개", "첫째 쪽 본문입니다 2026"], ["둘째 쪽: 근거 기반 질의응답과 출처 연결"]]);
    const r = await parse(pdf);
    expect(r.pageCount).toBe(2);
    expect(r.skippedPages).toEqual([]);
    expect(r.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(r.pages[0]?.text).toContain("지식 관리 서비스 KnowFlow 소개");
    expect(r.pages[0]?.text).toContain("첫째 쪽 본문입니다 2026");
    expect(r.pages[1]?.text).toContain("근거 기반 질의응답");
  });

  it("영문 텍스트 PDF에서 일부 쪽만 스캔이면 텍스트 쪽만 남기고 원본 쪽 번호를 유지한다", async () => {
    const pdf = makePdf([["Retrieval augmented answers with citations"], null, ["Page three keeps its original number 3"]]);
    const r = await parse(pdf);
    expect(r.pageCount).toBe(3);
    expect(r.pages.map((p) => p.page)).toEqual([1, 3]);
    expect(r.skippedPages).toEqual([2]);
    expect(r.pages[1]?.text).toContain("original number 3");
  });

  it("텍스트가 없는 PDF는 scanned_pdf", async () => {
    await expectCode(parse(makePdf([null, null])), PDF_ERROR_CODES.scannedPdf);
  });

  it("텍스트 쪽 비율이 임계값 미만이면 scanned_pdf", async () => {
    await expectCode(parse(makePdf([["충분히 긴 한국어 텍스트 쪽입니다 하나"], null, null, null])), PDF_ERROR_CODES.scannedPdf);
  });

  it("PUA 문자가 대부분인 깨진 텍스트도 scanned_pdf", async () => {
    await expectCode(parse(makePdf([[" 12"]])), PDF_ERROR_CODES.scannedPdf);
  });

  it("500쪽 초과는 too_many_pages", async () => {
    const pdf = makePdf(Array.from({ length: 501 }, () => ["page"]), { shareContent: true });
    await expectCode(parse(pdf), PDF_ERROR_CODES.tooManyPages);
  });

  it("암호화 PDF는 encrypted_pdf", async () => {
    await expectCode(parse(makePdf([["비밀 문서 본문입니다 열리면 안 됩니다"]], { encrypted: true })), PDF_ERROR_CODES.encryptedPdf);
  });

  it("매직 바이트가 없으면 invalid_pdf", async () => {
    await expectCode(parse(new Uint8Array(Buffer.from("<html>not a pdf</html>"))), PDF_ERROR_CODES.invalidPdf);
  });

  it("매직 바이트만 맞고 구조가 깨졌으면 invalid_pdf", async () => {
    await expectCode(parse(new Uint8Array(Buffer.from("%PDF-1.7\ngarbage"))), PDF_ERROR_CODES.invalidPdf);
  });

  it("해시가 다르면 파싱하지 않고 content_hash_mismatch", async () => {
    const pdf = makePdf([["본문"]]);
    await expectCode(parsePdf(pdf, "0".repeat(64)), PDF_ERROR_CODES.contentHashMismatch);
  });

  it("입력 바이트 상한을 넘으면 해시 계산 전에 file_too_large", async () => {
    const pdf = makePdf([["크기 상한 확인용 본문입니다 열 글자"]]);
    // 해시가 틀려도 크기 검사가 먼저다
    await expectCode(parsePdf(pdf, "0".repeat(64), { limits: { maxInputBytes: pdf.length - 1 } }), PDF_ERROR_CODES.fileTooLarge);
    expect((await parse(pdf, { limits: { maxInputBytes: pdf.length } })).pageCount).toBe(1);
  });

  it("하위 프로세스도 stdin을 상한에서 끊고 file_too_large를 낸다", async () => {
    // 입력 수집은 unpdf를 불러오기 전이라 진입 경로 인자는 쓰이지 않는다
    const child = fileURLToPath(new URL("./parser-child.mts", import.meta.url));
    const limits = { readPaths: [], timeoutMs: 20_000, maxOldSpaceMb: 64, maxOutputBytes: 1024 };
    const over = JSON.parse(await runSandboxed(child, new Uint8Array(4096), { ...limits, args: ["unused", "500", "1024"] }));
    expect(over).toEqual({ ok: false, error: PDF_ERROR_CODES.fileTooLarge });
    const badArg = JSON.parse(await runSandboxed(child, new Uint8Array(8), { ...limits, args: ["unused", "500", "x"] }));
    expect(badArg).toEqual({ ok: false, error: PDF_ERROR_CODES.fileTooLarge });
  });

  it("시간 초과는 parser_timeout", async () => {
    await expectCode(parse(makePdf([["시간 초과 확인용 본문입니다 열 글자"]]), { limits: { timeoutMs: 1 } }), PDF_ERROR_CODES.parserTimeout);
  });

  it("출력 초과는 parser_output_too_large", async () => {
    await expectCode(parse(makePdf([["출력 초과 확인용 본문입니다 열 글자"]]), { limits: { maxOutputBytes: 8 } }), PDF_ERROR_CODES.parserOutputTooLarge);
  });

  it("중단 신호는 영구 실패가 아니라 신호의 사유로 거부한다", async () => {
    const ac = new AbortController();
    const p = parse(makePdf([["중단 확인용 본문입니다 열 글자 이상"]]), { signal: ac.signal });
    ac.abort(new Error("lease_lost"));
    await expect(p).rejects.toThrow("lease_lost");
  });
});

describe("normalizeText · isTextPage", () => {
  it("NFC 정규화하고 \\u0000·제어문자·짝 없는 서로게이트를 지운다", () => {
    const decomposed = "한글"; // 한글(자모 분해형)
    expect(normalizeText(`${decomposed}\u0000\u0007 a\r\nb\uD800c\u0085`)).toBe("한글 a\nbc");
  });

  it("유효 문자 수·비율·PUA 비율로 텍스트 쪽을 판정한다", () => {
    expect(isTextPage("한국어 문장이 충분히 들어 있는 쪽")).toBe(true);
    expect(isTextPage("짧음")).toBe(false);
    expect(isTextPage("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!abcdefghij")).toBe(false);
    expect(isTextPage(`${"".repeat(5)}가나다라마바사아자차카타파하`)).toBe(false);
    expect(isTextPage("")).toBe(false);
  });
  it("문자 수는 코드 포인트 단위로 센다(보조 평면 PUA 포함, 공백 제외)", () => {
    expect(countChars("한글 abc 123")).toEqual({ nonSpace: 8, valid: 8, pua: 0 });
    expect(countChars("\u{F0000} 가!")).toEqual({ nonSpace: 4, valid: 1, pua: 2 });
    expect(countChars(" \n\t")).toEqual({ nonSpace: 0, valid: 0, pua: 0 });
  });
});
