import { describe, expect, it } from "vitest";
import { verifyCitations } from "../src/index.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOT_RETRIEVED = "33333333-3333-4333-8333-333333333333";

const chunkA = { chunk_id: A, source_id: "s1", locator: { page: 3 } };
const chunkB = { chunk_id: B, source_id: "s2", locator: { t_start: 10, t_end: 20 } };
const allowedChunks = [chunkA, chunkB];

describe("verifyCitations", () => {
  it("전부 유효하면 ok이고 allowedChunks의 레코드를 그대로 돌려준다", () => {
    const result = verifyCitations({ cited: [A, B], allowedChunks });
    expect(result).toEqual({ verified: [chunkA, chunkB], rejected: [], status: "ok" });
    expect(result.verified[0]).toBe(chunkA);
  });

  it("검색되지 않은 chunk_id를 거부한다", () => {
    expect(verifyCitations({ cited: [NOT_RETRIEVED], allowedChunks })).toEqual({
      verified: [],
      rejected: [NOT_RETRIEVED],
      status: "none",
    });
  });

  it("빈 인용은 none이다", () => {
    expect(verifyCitations({ cited: [], allowedChunks })).toEqual({
      verified: [],
      rejected: [],
      status: "none",
    });
  });

  it("일부만 유효하면 partial이다", () => {
    expect(verifyCitations({ cited: [A, NOT_RETRIEVED], allowedChunks })).toEqual({
      verified: [chunkA],
      rejected: [NOT_RETRIEVED],
      status: "partial",
    });
  });

  it("순서와 중복을 보존한다", () => {
    const result = verifyCitations({
      cited: [B, NOT_RETRIEVED, A, B, NOT_RETRIEVED],
      allowedChunks,
    });
    expect(result.verified).toEqual([chunkB, chunkA, chunkB]);
    expect(result.rejected).toEqual([NOT_RETRIEVED, NOT_RETRIEVED]);
    expect(result.status).toBe("partial");
  });

  it("대문자 UUID는 정규화하지 않고 거부한다", () => {
    const upperChunk = { chunk_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" };
    expect(
      verifyCitations({ cited: [upperChunk.chunk_id], allowedChunks: [upperChunk] }),
    ).toEqual({ verified: [], rejected: [upperChunk.chunk_id], status: "none" });
  });

  it("대문자 인용을 소문자 청크에 맞춰 정규화하지 않는다", () => {
    const lowerChunk = { chunk_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const upperId = lowerChunk.chunk_id.toUpperCase();
    expect(verifyCitations({ cited: [upperId], allowedChunks: [lowerChunk] })).toEqual({
      verified: [],
      rejected: [upperId],
      status: "none",
    });
  });

  it.each([
    ["비UUID", "chunk-1"],
    ["개행이 붙은 UUID", `${A}\n`],
    ["공백이 붙은 UUID", ` ${A}`],
    ["빈 문자열", ""],
  ])("%s 문자열을 거부한다", (_name, value) => {
    const chunk = { chunk_id: value };
    expect(verifyCitations({ cited: [value], allowedChunks: [chunk] }).status).toBe("none");
  });

  it.each([
    ["숫자", 1],
    ["null", null],
    ["undefined", undefined],
    ["배열", [A]],
    ["String 객체", new String(A)],
  ])("비문자열 %s을 거부한다", (_name, value) => {
    expect(verifyCitations({ cited: [value], allowedChunks })).toEqual({
      verified: [],
      rejected: [value],
      status: "none",
    });
  });

  it("cited가 배열이 아니면 값 전체를 거부한다", () => {
    expect(verifyCitations({ cited: A, allowedChunks })).toEqual({
      verified: [],
      rejected: [A],
      status: "none",
    });
    expect(verifyCitations({ cited: { chunk_id: A }, allowedChunks })).toEqual({
      verified: [],
      rejected: [{ chunk_id: A }],
      status: "none",
    });
  });

  it("모델이 준 위치를 쓰지 않는다", () => {
    const forged = { chunk_id: A, locator: { page: 999 } };
    const result = verifyCitations({ cited: [forged, A], allowedChunks });
    expect(result.verified).toEqual([chunkA]);
    expect(result.verified[0]?.locator).toEqual({ page: 3 });
    expect(result.rejected).toEqual([forged]);
  });

  it("Object.prototype 키로 우회할 수 없다", () => {
    expect(verifyCitations({ cited: ["__proto__", "constructor"], allowedChunks }).status).toBe(
      "none",
    );
  });
});
