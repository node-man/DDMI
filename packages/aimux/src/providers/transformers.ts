/**
 * Transformers.js EmbeddingProvider
 *
 * 빌트인 임베딩. npm install만으로 동작. 외부 서버 불필요.
 * @xenova/transformers는 peerDependency (optional).
 *
 * aimux에서는 embedder 구현을 직접 포함한다.
 * ddmi의 core/embedder.ts에 의존하지 않음 — 완전히 독립적.
 */

import type { EmbeddingProvider } from "../types.js";

const BATCH_SIZE = 32;

export async function createTransformersProvider(
  modelName: string = "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
): Promise<EmbeddingProvider> {
  // Dynamic import — @xenova/transformers is ESM-only and an optional peerDep
  const { pipeline } = await import("@xenova/transformers");

  const pipe = await pipeline("feature-extraction", modelName, {
    quantized: true,
  });

  // Detect dimensions from a test embedding
  const testOutput = await pipe("test", { pooling: "mean", normalize: true });
  const dims = testOutput.dims[1] as number;

  return {
    name: "transformers",

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const results: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        for (const text of batch) {
          const output = await pipe(text, {
            pooling: "mean",
            normalize: true,
          });
          results.push(Array.from(output.data as Float32Array));
        }
      }

      return results;
    },

    async embedOne(text: string): Promise<number[]> {
      const output = await pipe(text, {
        pooling: "mean",
        normalize: true,
      });
      return Array.from(output.data as Float32Array);
    },

    dimensions(): number {
      return dims;
    },

    async healthCheck(): Promise<boolean> {
      try {
        const output = await pipe("health check", { pooling: "mean", normalize: true });
        const vec = Array.from(output.data as Float32Array);
        return vec.length === dims;
      } catch {
        return false;
      }
    },
  };
}
