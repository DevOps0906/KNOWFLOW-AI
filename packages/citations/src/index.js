// 소문자 UUID만 인정한다. 모델 출력을 정규화하면 검색되지 않은 ID가 통과할 여지가 생긴다.
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function verifyCitations({ cited, allowedChunks }) {
  // cited는 모델 출력이라 타입을 믿지 않는다. 배열이 아니면 값 전체를 거부한다.
  if (!Array.isArray(cited)) return { verified: [], rejected: [cited], status: "none" };

  const allowedById = new Map(allowedChunks.map((chunk) => [chunk.chunk_id, chunk]));
  const verified = [];
  const rejected = [];

  for (const candidate of cited) {
    const chunk =
      typeof candidate === "string" && LOWERCASE_UUID.test(candidate)
        ? allowedById.get(candidate)
        : undefined;
    if (chunk) verified.push(chunk);
    else rejected.push(candidate);
  }

  const status = verified.length === 0 ? "none" : rejected.length === 0 ? "ok" : "partial";
  return { verified, rejected, status };
}
