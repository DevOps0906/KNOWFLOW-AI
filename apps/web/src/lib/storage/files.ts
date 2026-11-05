// PDF 업로드 공통 상수·검사. 서버(A-04)와 브라우저(S-09)가 같은 값을 쓴다.
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // PRD 8-1: 파일 1개 50MB
export const MAX_FILES_PER_REQUEST = 10; // 한 번에 10개
export const MAX_TITLE_LENGTH = 300;

/** 경로·제어 문자·위험 문자를 걷어낸 파일명(확장자 포함). 비면 null. */
export function sanitizeFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, 200).join("");
}

export function hasPdfExtension(name: string): boolean {
  return /\.pdf$/i.test(name);
}

/** 화면에 보일 제목: 정규화한 파일명에서 .pdf를 뗀 값 */
export function titleFromFileName(raw: unknown): string | null {
  const name = sanitizeFileName(raw);
  if (!name) return null;
  const title = name.replace(/\.pdf$/i, "").trim();
  return title ? Array.from(title).slice(0, MAX_TITLE_LENGTH).join("") : null;
}

/** PDF는 앞 1024바이트 안에 `%PDF-`가 있어야 한다(PDF 명세의 헤더 허용 범위). */
export function hasPdfMagic(head: Uint8Array): boolean {
  const limit = Math.min(head.length, 1024) - 4;
  for (let i = 0; i < limit; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}
