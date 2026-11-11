// compose 종단 검증·핸들러 테스트용 고정 PDF(fixtures/sample/knowflow-sample.pdf)를 만든다. 실행: node apps/worker/scripts/make-sample-pdf.mjs
// 글꼴은 Identity-H + ToUnicode(코드=UTF-16 코드 단위)라 한국어 텍스트가 그대로 추출된다(src/pdf/parser.test.ts와 같은 방식).
// 4쪽: 1·3쪽 짧은 본문, 2쪽 긴 본문(청크 여러 개), 4쪽은 텍스트 없는 쪽(스캔 쪽 대용, 건너뜀).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function makePdf(pages) {
  const objs = [];
  const add = (body) => objs.push(body);
  const stream = (dict, data) => `<< ${dict} /Length ${Buffer.byteLength(data, "latin1")} >>\nstream\n${data}\nendstream`;
  const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

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
  const content = (lines) =>
    lines === null ? "0 0 m 200 200 l S" : `BT /F1 10 Tf 12 TL 40 760 Td ${lines.map((l) => `<${hex(l)}> Tj T*`).join(" ")} ET`;
  const kids = pages.map((lines) => {
    const c = add(stream("", content(lines)));
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
  const offsets = objs.map((body, i) => {
    const at = Buffer.byteLength(out, "latin1");
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const SAMPLE_PAGES = [
  ["KnowFlow 샘플 자료: 지식 관리 서비스 소개", "이 문서는 자료 처리 종단 검증용 고정 파일입니다.", "PDF와 웹 페이지를 모아 근거 기반으로 답합니다."],
  Array.from({ length: 40 }, (_, i) => `둘째 쪽 ${i + 1}번째 문단: 청킹은 쪽 경계를 넘지 않고 겹침을 둡니다.`),
  ["셋째 쪽: 출처는 쪽 번호와 문자 위치로 연결됩니다.", "검색은 전문검색과 한국어 trigram을 함께 씁니다."],
  null,
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/sample/knowflow-sample.pdf");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, makePdf(SAMPLE_PAGES));
  console.log(out);
}
