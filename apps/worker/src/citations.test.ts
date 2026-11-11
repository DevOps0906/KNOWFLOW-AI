import { describe, expect, it } from "vitest";
import { verifyCitations } from "citations";

const chunkId = "11111111-1111-4111-8111-111111111111";

describe("citations 패키지 소비", () => {
  it("Worker에서 불러와 검색된 청크만 인정한다", () => {
    const result = verifyCitations({
      cited: [chunkId, "22222222-2222-4222-8222-222222222222"],
      allowedChunks: [{ chunk_id: chunkId }],
    });

    expect(result.status).toBe("partial");
    expect(result.verified).toEqual([{ chunk_id: chunkId }]);
  });
});
