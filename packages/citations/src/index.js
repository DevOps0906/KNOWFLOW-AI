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

const isTime = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * 장면 카드와 겹치는 청크(task-029). 구간은 반열린 [t_start, t_end)라 맞닿기만 하면 겹침이 아니다.
 * 겹친 길이 내림차순(같으면 입력 순서)이며, 겹치는 청크가 없으면 빈 배열 = 그 카드는 인용 불가.
 * 시각 locator(t_start·t_end 유한 수, 끝 > 시작)가 없는 청크(PDF 등)는 건너뛴다.
 */
export function overlappingChunks(moment, chunks) {
  if (!moment || !isTime(moment.t_start) || !isTime(moment.t_end) || !(moment.t_end > moment.t_start)) return [];
  const scored = [];
  chunks.forEach((chunk, index) => {
    const loc = chunk?.locator;
    if (!loc || !isTime(loc.t_start) || !isTime(loc.t_end) || !(loc.t_end > loc.t_start)) return;
    const overlap = Math.min(moment.t_end, loc.t_end) - Math.max(moment.t_start, loc.t_start);
    if (overlap > 0) scored.push({ chunk, overlap, index });
  });
  scored.sort((a, b) => b.overlap - a.overlap || a.index - b.index);
  return scored.map((s) => s.chunk);
}
