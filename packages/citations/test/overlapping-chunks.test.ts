import { describe, expect, it } from "vitest";
import { overlappingChunks } from "../src/index.js";

const chunk = (id: string, t_start: number, t_end: number) => ({ chunk_id: id, locator: { t_start, t_end } });

describe("overlappingChunks", () => {
  it("반열린 구간: 맞닿기만 한 청크는 겹침이 아니다", () => {
    const chunks = [chunk("before", 0, 10), chunk("after", 20, 30)];
    expect(overlappingChunks({ t_start: 10, t_end: 20 }, chunks)).toEqual([]);
  });

  it("겹치는 청크 전부를 겹친 길이 내림차순으로 돌려주고 레코드를 그대로 쓴다", () => {
    const a = chunk("a", 0, 12);
    const b = chunk("b", 12, 30);
    const c = chunk("c", 28, 40);
    const result = overlappingChunks({ t_start: 10, t_end: 30 }, [a, c, b]);
    expect(result.map((x) => x.chunk_id)).toEqual(["b", "a", "c"]);
    expect(result[0]).toBe(b);
  });

  it("겹친 길이가 같으면 t_start 오름차순, 그다음 입력 순서", () => {
    const result = overlappingChunks({ t_start: 0, t_end: 100 }, [chunk("late", 50, 60), chunk("early", 10, 20), chunk("early2", 10, 20)]);
    expect(result.map((x) => x.chunk_id)).toEqual(["early", "early2", "late"]);
  });

  it("장면 안에 들어 있거나 장면을 감싸는 청크도 겹침이다", () => {
    expect(overlappingChunks({ t_start: 5, t_end: 6 }, [chunk("wrap", 0, 100)]).map((x) => x.chunk_id)).toEqual(["wrap"]);
    expect(overlappingChunks({ t_start: 0, t_end: 100 }, [chunk("in", 5, 6)]).map((x) => x.chunk_id)).toEqual(["in"]);
  });

  it("겹치는 청크가 없거나 시각 구간이 올바르지 않으면 빈 배열(인용 불가)", () => {
    expect(overlappingChunks({ t_start: 100, t_end: 110 }, [chunk("a", 0, 10)])).toEqual([]);
    expect(overlappingChunks({ t_start: 0, t_end: 10 }, [])).toEqual([]);
    const odd = [{ locator: { page: 3 } }, { locator: { t_start: "0", t_end: 10 } }, { locator: { t_start: 5, t_end: 5 } }, {}];
    expect(overlappingChunks({ t_start: 0, t_end: 10 }, odd)).toEqual([]);
    expect(overlappingChunks({ t_start: 10, t_end: 10 }, [chunk("a", 0, 20)])).toEqual([]);
    expect(overlappingChunks({ t_start: Number.NaN, t_end: 10 }, [chunk("a", 0, 20)])).toEqual([]);
  });
});
