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

const isTimeRange = (v) =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite(v.t_start) &&
  Number.isFinite(v.t_end) &&
  v.t_end > v.t_start;

export function overlappingChunks(moment, chunks) {
  if (!isTimeRange(moment)) return [];
  const hits = [];
  chunks.forEach((chunk, index) => {
    const loc = chunk?.locator;
    if (!isTimeRange(loc)) return;
    // 반열린 구간 [s, e): 겹친 길이가 0이면(맞닿음 포함) 겹침이 아니다
    const overlap = Math.min(moment.t_end, loc.t_end) - Math.max(moment.t_start, loc.t_start);
    if (overlap > 0) hits.push({ chunk, overlap, start: loc.t_start, index });
  });
  hits.sort((a, b) => b.overlap - a.overlap || a.start - b.start || a.index - b.index);
  return hits.map((h) => h.chunk);
}
