// 임베딩 인터페이스(task-011 구현 결정 9). 실제 호출(임베딩 서버)과 벡터 저장은 task-013이 붙인다. 여기서는 인터페이스·목·검사만.
import { createHash } from "node:crypto";
import { PermanentError } from "../runner.js";
import { EMBEDDING_SETTINGS, INGEST_ERROR_CODES } from "./settings.js";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface EmbeddableChunk {
  content: string;
  /** 이미 저장된 청크의 모델(없으면 null) */
  embedding_model: string | null;
}

export interface EmbeddedChunk<T extends EmbeddableChunk> {
  chunk: T;
  embedding: number[];
  embedding_model: string;
}

const mismatch = () => new PermanentError(INGEST_ERROR_CODES.embeddingModelMismatch);

/**
 * 청크를 임베딩한다. 한 자료(나아가 한 색인) 안에 다른 모델의 벡터가 섞이지 않게 다음을 거부한다:
 * 공급자 모델·차원이 설정과 다름, 이미 다른 모델로 임베딩된 청크, 공급자가 돌려준 개수·차원 불일치.
 */
export async function embedChunks<T extends EmbeddableChunk>(
  provider: EmbeddingProvider,
  chunks: T[],
  opts: { settings?: { model: string; dimensions: number }; signal?: AbortSignal } = {},
): Promise<EmbeddedChunk<T>[]> {
  const settings = opts.settings ?? EMBEDDING_SETTINGS;
  if (provider.model !== settings.model || provider.dimensions !== settings.dimensions) throw mismatch();
  if (chunks.some((c) => c.embedding_model !== null && c.embedding_model !== provider.model)) throw mismatch();
  if (chunks.length === 0) return [];
  const vectors = await provider.embed(
    chunks.map((c) => c.content),
    opts.signal,
  );
  if (vectors.length !== chunks.length || vectors.some((v) => v.length !== settings.dimensions || !v.every(Number.isFinite))) {
    throw mismatch();
  }
  return chunks.map((chunk, i) => ({ chunk, embedding: vectors[i]!, embedding_model: provider.model }));
}

/** 테스트용 목: 내용 해시로 결정적인 단위 벡터를 만든다(네트워크 없음). */
export function createMockEmbeddingProvider(model: string = EMBEDDING_SETTINGS.model, dimensions: number = EMBEDDING_SETTINGS.dimensions): EmbeddingProvider {
  return {
    model,
    dimensions,
    async embed(texts) {
      return texts.map((t) => {
        const seed = createHash("sha256").update(t).digest();
        const v = Array.from({ length: dimensions }, (_, i) => (seed[i % seed.length]! - 127.5) / 127.5);
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}
