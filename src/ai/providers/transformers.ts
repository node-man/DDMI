/**
 * Transformers.js EmbeddingProvider — 기존 embedder.ts를 래핑
 *
 * 빌트인 임베딩. npm install만으로 동작. 외부 서버 불필요.
 */

import { createEmbedder, type Embedder } from "../../core/embedder.js";
import type { EmbeddingProvider } from "../../types.js";

export async function createTransformersProvider(
  modelName?: string,
): Promise<EmbeddingProvider> {
  const embedder: Embedder = await createEmbedder(modelName);

  return {
    name: "transformers",

    async embed(texts: string[]): Promise<number[][]> {
      return embedder.embed(texts);
    },

    async embedOne(text: string): Promise<number[]> {
      return embedder.embedOne(text);
    },

    dimensions(): number {
      return embedder.dimensions();
    },

    async healthCheck(): Promise<boolean> {
      try {
        const vec = await embedder.embedOne("health check");
        return vec.length === embedder.dimensions();
      } catch {
        return false;
      }
    },
  };
}
