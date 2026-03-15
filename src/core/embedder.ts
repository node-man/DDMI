/**
 * Embedder — transformers.js 임베딩 래퍼
 *
 * 텍스트를 벡터로 변환한다.
 * - 모델: paraphrase-multilingual-MiniLM-L12-v2 (384차원)
 * - 배치 처리: 32개씩
 * - L2 normalization 적용
 */

export interface Embedder {
  init(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;
}

export async function createEmbedder(
  modelName: string = "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
): Promise<Embedder> {
  // TODO: implement with @xenova/transformers
  throw new Error("Not implemented");
}
