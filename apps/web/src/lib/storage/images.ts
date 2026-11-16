// task-030 캡처 이미지 검사(구현 결정 3): WebP·JPEG, 2MB 이하, 가로·세로 각 2560 이하.
// 형식은 Content-Type이 아니라 매직 바이트로 정하고, 크기는 파일 헤더에서 읽는다(디코딩하지 않는다).

export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
export const MAX_CAPTURE_DIMENSION = 2560;

export type CaptureMime = "image/webp" | "image/jpeg";

export interface ImageInfo {
  mime: CaptureMime;
  width: number;
  height: number;
}

const ascii = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8 ")) {
    // 키프레임 시작 코드 9D 01 2A 뒤 14비트 가로·세로
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (b[21]! | ((b[22]! & 0x3f) << 8));
    const height = 1 + ((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10));
    return { width, height };
  }
  if (ascii(b, 12, "VP8X")) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    while (marker === 0xff && i + 2 < b.length) marker = b[++i + 1]!;
    // 길이 없는 표식(RSTn·SOI·TEM)
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // SOF 전에 EOI·SOS
    const length = u16be(b, i + 2);
    // 선언 길이가 버퍼를 넘으면 잘린 파일
    if (length < 2 || i + 2 + length > b.length) return null;
    // SOF0~SOF15(DHT C4·JPG C8·DAC CC 제외). SOF는 정밀도·높이·너비·성분 수까지 최소 8바이트
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** 매직 바이트로 형식을 정하고 헤더에서 크기를 읽는다. 형식이 아니거나 헤더를 못 읽으면 null */
export function sniffCaptureImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    const size = webpSize(bytes);
    return size ? { mime: "image/webp", ...size } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    return size ? { mime: "image/jpeg", ...size } : null;
  }
  return null;
}

/** 크기 상한 안인지(0 크기 포함 거부) */
export function captureDimensionsOk(info: ImageInfo) {
  return info.width >= 1 && info.height >= 1 && info.width <= MAX_CAPTURE_DIMENSION && info.height <= MAX_CAPTURE_DIMENSION;
}

/**
 * 요청 본문을 상한까지만 읽는다. 상한을 넘으면 그 자리에서 스트림을 끊고 too_large.
 * Content-Length가 상한을 넘으면 읽지 않는다.
 */
export async function readBodyCapped(
  request: Request,
  max: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; kind: "too_large" | "empty" }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { ok: false, kind: "too_large" };
  if (!request.body) return { ok: false, kind: "empty" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.length;
    if (received > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, kind: "too_large" };
    }
    chunks.push(value);
  }
  if (received === 0) return { ok: false, kind: "empty" };
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { ok: true, bytes };
}
