/**
 * Embedder — transformers.js 임베딩 래퍼
 *
 * 텍스트를 벡터로 변환한다.
 * - 모델: paraphrase-multilingual-MiniLM-L12-v2 (384차원)
 * - 배치 처리: 32개씩
 * - L2 normalization 적용
 */

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;
}

const BATCH_SIZE = 32;

export async function createEmbedder(
  modelName: string = "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
): Promise<Embedder> {
  // Dynamic import — @xenova/transformers is ESM-only
  const { pipeline } = await import("@xenova/transformers");

  const pipe = await pipeline("feature-extraction", modelName, {
    quantized: true,
  });

  // Detect dimensions from a test embedding
  const testOutput = await pipe("test", { pooling: "mean", normalize: true });
  const dims = testOutput.dims[1] as number;

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const results: number[][] = [];

      // Process in batches
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
  };
}
