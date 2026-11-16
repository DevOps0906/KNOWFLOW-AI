import { describe, expect, it } from "vitest";
import { overlappingChunks } from "../src/index.js";

const c = (id: string, t_start: number, t_end: number) => ({ chunk_id: id, locator: { t_start, t_end } });

describe("overlappingChunks", () => {
  const moment = { t_start: 10, t_end: 20 };

  it("반열린 구간: 맞닿기만 하면 겹침이 아니다", () => {
    expect(overlappingChunks(moment, [c("a", 0, 10), c("b", 20, 30)])).toEqual([]);
  });

  it("조금이라도 겹치면 포함하고 겹친 길이 내림차순으로 돌려준다", () => {
    const a = c("a", 0, 12); // 2
    const b = c("b", 8, 30); // 10
    const d = c("d", 15, 18); // 3
    expect(overlappingChunks(moment, [a, b, d])).toEqual([b, d, a]);
  });

  it("겹친 길이가 같으면 입력 순서를 지킨다", () => {
    const a = c("a", 10, 15);
    const b = c("b", 15, 20);
    expect(overlappingChunks(moment, [b, a])).toEqual([b, a]);
  });

  it("겹치는 청크가 없거나 입력이 비면 빈 배열", () => {
    expect(overlappingChunks(moment, [])).toEqual([]);
    expect(overlappingChunks(moment, [c("a", 30, 40)])).toEqual([]);
  });

  it("시각 locator가 없거나 잘못된 청크·잘못된 장면은 건너뛴다", () => {
    expect(overlappingChunks(moment, [{ chunk_id: "p", locator: { page: 1 } }, { chunk_id: "x" }, c("n", NaN, 15)])).toEqual([]);
    expect(overlappingChunks({ t_start: 5, t_end: 5 }, [c("a", 0, 10)])).toEqual([]);
  });

  it("청크 레코드를 그대로 돌려준다", () => {
    const a = c("a", 0, 15);
    expect(overlappingChunks(moment, [a])[0]).toBe(a);
  });
});
