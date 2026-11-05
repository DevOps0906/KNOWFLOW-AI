import { describe, expect, it, vi } from "vitest";
import { hasPdfExtension, hasPdfMagic, MAX_FILE_BYTES, sanitizeFileName, titleFromFileName } from "./files";
import { createSourceHandlers, type SourceAuditEvent, type SourcesBackend } from "./handlers";
import { clientFileProblem, uploadPdfs, type UploadDeps } from "./upload-flow";

const SITE = "https://app.example.test";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER}/${PROJECT}/${FILE_ID}.pdf`;
const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
const HASH = "a".repeat(64);

function setup(overrides: Partial<SourcesBackend> = {}) {
  const logs: SourceAuditEvent[] = [];
  const backend: SourcesBackend = {
    getUserId: vi.fn(async () => USER),
    projectExists: vi.fn(async () => true),
    createUploadUrl: vi.fn(async (path: string) => ({ ok: true as const, token: `tok-${path.slice(-8)}`, signedUrl: `https://storage.test/${path}` })),
    readHead: vi.fn(async () => ({ ok: true as const, size: 1000, head: PDF_HEAD })),
    register: vi.fn(async () => ({ ok: true as const, sourceId: "s1", jobId: "j1", duplicate: false })),
    ...overrides,
  };
  return { backend, logs, handlers: createSourceHandlers({ backend, siteUrl: SITE, log: (e) => logs.push(e) }) };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/projects/${PROJECT}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const pdfFile = (over: Record<string, unknown> = {}) => ({ name: "보고서.pdf", size: 1000, type: "application/pdf", ...over });
const registerItem = (over: Record<string, unknown> = {}) => ({ path: PATH, title: "보고서", contentHash: HASH, idempotencyKey: "key-1", ...over });

describe("파일명·매직 바이트", () => {
  it("경로 조작·제어 문자가 든 파일명을 정규화한다", () => {
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\Users\\a\\..\\evil.pdf")).toBe("evil.pdf");
    expect(sanitizeFileName("  ..hidden\u0000<name>.pdf ")).toBe("hiddenname.pdf");
    expect(sanitizeFileName("a\u202etxt.pdf")).toBe("atxt.pdf");
    expect(sanitizeFileName("../")).toBeNull();
    expect(sanitizeFileName(42)).toBeNull();
    expect(Array.from(sanitizeFileName("가".repeat(500) + ".pdf")!).length).toBe(200);
  });
  it("제목은 확장자를 뗀 정규화 이름", () => {
    expect(titleFromFileName("../x/보고서 2026.PDF")).toBe("보고서 2026");
    expect(titleFromFileName("...pdf")).toBe("pdf"); // 앞의 점은 제거된다
    expect(hasPdfExtension("a.PDF")).toBe(true);
    expect(hasPdfExtension("a.pdf.exe")).toBe(false);
  });
  it("PDF 매직 바이트는 앞 1024바이트 안의 %PDF-로 판정한다", () => {
    expect(hasPdfMagic(PDF_HEAD)).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode("MZ\x90\x00 this is an exe"))).toBe(false);
    expect(hasPdfMagic(new TextEncoder().encode("<html>%PDF-</html>"))).toBe(true);
    const late = new Uint8Array(2000);
    late.set(new TextEncoder().encode("%PDF-"), 1500);
    expect(hasPdfMagic(late)).toBe(false);
  });
});

describe("서명 업로드 URL 발급(step=upload_url)", () => {
  it("파일명이 아니라 무작위 이름으로 본인·프로젝트 폴더 경로를 만든다", async () => {
    const { handlers, backend } = setup();
    const res = await handlers.post(post({ step: "upload_url", files: [pdfFile({ name: "../../etc/passwd.pdf" })] }), PROJECT);
    expect(res.status).toBe(200);
    const { uploads } = await res.json();
    expect(uploads[0].path).toMatch(new RegExp(`^${USER}/${PROJECT}/[0-9a-f-]{36}\\.pdf$`));
    expect(uploads[0].title).toBe("passwd");
    expect(backend.createUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("확장자가 .pdf가 아니거나 MIME이 PDF가 아니면 415", async () => {
    const { handlers, backend } = setup();
    for (const file of [pdfFile({ name: "a.exe" }), pdfFile({ type: "text/plain" }), pdfFile({ name: "a.pdf.exe" })]) {
      expect((await handlers.post(post({ step: "upload_url", files: [file] }), PROJECT)).status).toBe(415);
    }
    expect(backend.createUploadUrl).not.toHaveBeenCalled();
  });

  it("51MB는 413, 50MB 정확히는 통과", async () => {
    const { handlers } = setup();
    expect((await handlers.post(post({ step: "upload_url", files: [pdfFile({ size: 51 * 1024 * 1024 })] }), PROJECT)).status).toBe(413);
    expect((await handlers.post(post({ step: "upload_url", files: [pdfFile({ size: MAX_FILE_BYTES })] }), PROJECT)).status).toBe(200);
  });

  it("11개는 400이고 하나라도 틀리면 URL을 하나도 발급하지 않는다", async () => {
    const { handlers, backend } = setup();
    const eleven = Array.from({ length: 11 }, () => pdfFile());
    expect((await handlers.post(post({ step: "upload_url", files: eleven }), PROJECT)).status).toBe(400);
    expect((await handlers.post(post({ step: "upload_url", files: [pdfFile(), pdfFile({ name: "x.txt" })] }), PROJECT)).status).toBe(415);
    expect(backend.createUploadUrl).not.toHaveBeenCalled();
  });

  it("타인·없는 프로젝트는 404, 로그인 없으면 401", async () => {
    expect((await setup({ projectExists: async () => false }).handlers.post(post({ step: "upload_url", files: [pdfFile()] }), PROJECT)).status).toBe(404);
    expect((await setup({ getUserId: async () => null }).handlers.post(post({ step: "upload_url", files: [pdfFile()] }), PROJECT)).status).toBe(401);
  });

  it("감사 로그에는 파일명이 없다", async () => {
    const { handlers, logs } = setup();
    await handlers.post(post({ step: "upload_url", files: [pdfFile({ name: "기밀-계약서.pdf" })] }), PROJECT);
    expect(JSON.stringify(logs)).not.toContain("기밀");
    expect(logs[0]).toMatchObject({ event: "upload_url", outcome: "success", count: 1 });
  });
});

describe("등록(step=register)", () => {
  it("확장자만 .pdf이고 내용이 PDF가 아니면 415이며 등록하지 않는다", async () => {
    const { handlers, backend } = setup({
      readHead: async () => ({ ok: true, size: 100, head: new TextEncoder().encode("MZ fake executable") }),
    });
    const res = await handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT);
    expect(res.status).toBe(415);
    expect(backend.register).not.toHaveBeenCalled();
  });

  it("Storage 객체가 51MB면 413, 없으면 422", async () => {
    const big = setup({ readHead: async () => ({ ok: true, size: 51 * 1024 * 1024, head: PDF_HEAD }) });
    expect((await big.handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT)).status).toBe(413);
    const missing = setup({ readHead: async () => ({ ok: false, kind: "missing" }) });
    expect((await missing.handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT)).status).toBe(422);
  });

  it("성공하면 202와 자료·작업 id", async () => {
    const { handlers } = setup();
    const res = await handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT);
    expect(res.status).toBe(202);
    expect((await res.json()).results[0]).toMatchObject({ ok: true, sourceId: "s1", jobId: "j1", status: 202 });
  });

  it("다른 사용자·다른 프로젝트 경로, 경로 조작, 대문자 id는 DB 호출 없이 400", async () => {
    const { handlers, backend } = setup();
    const other = "99999999-9999-4999-8999-999999999999";
    for (const path of [
      `${other}/${PROJECT}/${FILE_ID}.pdf`,
      `${USER}/${other}/${FILE_ID}.pdf`,
      `${USER}/${PROJECT}/../${FILE_ID}.pdf`,
      `${USER}/${PROJECT}/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.pdf`,
      `${USER}/${PROJECT}/${FILE_ID}.exe`,
    ]) {
      expect((await handlers.post(post({ step: "register", items: [registerItem({ path })] }), PROJECT)).status).toBe(400);
    }
    expect(backend.readHead).not.toHaveBeenCalled();
    expect(backend.register).not.toHaveBeenCalled();
  });

  it("잘못된 해시·멱등 키는 400", async () => {
    const { handlers } = setup();
    for (const item of [registerItem({ contentHash: "xyz" }), registerItem({ idempotencyKey: "" }), registerItem({ idempotencyKey: "a b" })]) {
      expect((await handlers.post(post({ step: "register", items: [item] }), PROJECT)).status).toBe(400);
    }
  });

  it("같은 입력은 같은 request_hash, 다른 입력은 다른 request_hash를 DB에 넘긴다", async () => {
    const { handlers, backend } = setup();
    await handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT);
    await handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT);
    await handlers.post(post({ step: "register", items: [registerItem({ title: "다른 제목" })] }), PROJECT);
    const hashes = (backend.register as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { requestHash: string }).requestHash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it("DB 결과를 상태 코드로 옮긴다: 409·429·404", async () => {
    for (const [kind, status] of [["conflict", 409], ["limit", 429], ["not_found", 404], ["too_large", 413], ["unsupported", 415]] as const) {
      const { handlers } = setup({ register: async () => ({ ok: false, kind }) });
      expect((await handlers.post(post({ step: "register", items: [registerItem()] }), PROJECT)).status).toBe(status);
    }
  });

  it("여러 개 중 일부만 실패하면 202와 항목별 결과", async () => {
    let n = 0;
    const { handlers } = setup({
      register: async () => (++n === 1 ? { ok: true, sourceId: "s1", jobId: "j1", duplicate: false } : { ok: false, kind: "conflict" }),
    });
    const second = `${USER}/${PROJECT}/44444444-4444-4444-8444-444444444444.pdf`;
    const res = await handlers.post(post({ step: "register", items: [registerItem(), registerItem({ path: second, idempotencyKey: "key-2" })] }), PROJECT);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
  });

  it("다른 Origin·JSON 아님·알 수 없는 step은 400", async () => {
    const { handlers } = setup();
    expect((await handlers.post(post({ step: "register", items: [registerItem()] }, { origin: "https://evil.test" }), PROJECT)).status).toBe(400);
    expect((await handlers.post(post("{bad"), PROJECT)).status).toBe(400);
    expect((await handlers.post(post({ step: "nope" }), PROJECT)).status).toBe(400);
    expect((await handlers.post(post({ step: "register", items: [registerItem()] }), "not-a-uuid")).status).toBe(404);
  });
});

describe("브라우저 업로드 흐름", () => {
  const file = (name = "a.pdf", size = 10, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });

  function flowDeps(responses: Array<Response | Error>, upload: UploadDeps["upload"] = async () => ({})) {
    const queue = [...responses];
    const fetchMock = vi.fn(async () => {
      const next = queue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const deps: UploadDeps = { fetch: fetchMock as unknown as typeof fetch, upload, hash: async () => HASH, newKey: () => "key" };
    return { deps, fetchMock };
  }

  it("선택 직후 형식·크기 문제를 알려 주고 서버를 부르지 않는다", () => {
    expect(clientFileProblem({ name: "a.txt", size: 1, type: "text/plain" })).toMatch(/PDF/);
    expect(clientFileProblem({ name: "a.pdf", size: MAX_FILE_BYTES + 1, type: "application/pdf" })).toMatch(/50MB/);
    expect(clientFileProblem({ name: "a.pdf", size: 5, type: "application/pdf" })).toBeNull();
  });

  it("발급 → 업로드 → 등록 순서로 진행하고 완료를 표시한다", async () => {
    const { deps, fetchMock } = flowDeps([
      Response.json({ uploads: [{ path: PATH, title: "a", token: "t" }] }),
      Response.json({ results: [{ path: PATH, ok: true }] }, { status: 202 }),
    ]);
    const upload = vi.fn(async () => ({}));
    const seen: string[] = [];
    const out = await uploadPdfs(PROJECT, [file()], { ...deps, upload }, (s) => seen.push(s[0]!.status));
    expect(out.accepted).toBe(1);
    expect(upload).toHaveBeenCalledWith(PATH, "t", expect.any(File));
    expect(seen).toEqual(expect.arrayContaining(["uploading", "registering", "done"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("업로드가 실패한 파일은 등록하지 않는다", async () => {
    const { deps, fetchMock } = flowDeps([Response.json({ uploads: [{ path: PATH, title: "a", token: "t" }] })]);
    const states: string[] = [];
    const out = await uploadPdfs(PROJECT, [file()], { ...deps, upload: async () => ({ error: "x" }) }, (s) => states.push(s[0]!.status));
    expect(out.accepted).toBe(0);
    expect(states.at(-1)).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("서버 거부 메시지를 파일 상태에 보여 준다(네트워크 오류 포함)", async () => {
    const rejected = flowDeps([Response.json({ error: { message: "PDF 파일만 올릴 수 있습니다." } }, { status: 415 })]);
    let last: string | undefined;
    await uploadPdfs(PROJECT, [file()], rejected.deps, (s) => (last = s[0]!.message));
    expect(last).toContain("PDF");
    const offline = flowDeps([new Error("offline")]);
    await uploadPdfs(PROJECT, [file()], offline.deps, (s) => (last = s[0]!.message));
    expect(last).toContain("네트워크");
  });

  it("11개를 고르면 서버를 부르지 않는다", async () => {
    const { deps, fetchMock } = flowDeps([]);
    const out = await uploadPdfs(PROJECT, Array.from({ length: 11 }, () => file()), deps, () => {});
    expect(out.accepted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
