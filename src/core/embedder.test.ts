import { describe, it, expect, beforeAll } from "vitest";
import { createEmbedder, type Embedder } from "./embedder.js";

// Model download may take time on first run
let embedder: Embedder;

beforeAll(async () => {
  embedder = await createEmbedder();
}, 120_000); // 2 min timeout for model download

describe("Embedder", () => {
  it("returns correct dimensions (384 for multilingual model)", () => {
    expect(embedder.dimensions()).toBe(384);
  });

  it("embeds a single text", async () => {
    const vec = await embedder.embedOne("Hello world");
    expect(vec).toHaveLength(384);
    expect(typeof vec[0]).toBe("number");
  });

  it("returns normalized vectors (L2 norm ≈ 1)", async () => {
    const vec = await embedder.embedOne("테스트 문장입니다");
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 1);
  });

  it("embeds multiple texts in batch", async () => {
    const vecs = await embedder.embed([
      "First document",
      "Second document",
      "Third document",
    ]);
    expect(vecs).toHaveLength(3);
    expect(vecs[0]).toHaveLength(384);
    expect(vecs[1]).toHaveLength(384);
  });

  it("returns empty array for empty input", async () => {
    const vecs = await embedder.embed([]);
    expect(vecs).toEqual([]);
  });

  it("similar texts have higher cosine similarity", async () => {
    const vecs = await embedder.embed([
      "MDverse는 프로젝트 지식 인프라다",
      "프로젝트의 지식을 관리하는 인프라 도구",
      "오늘 날씨가 좋습니다",
    ]);

    const sim01 = cosine(vecs[0], vecs[1]);
    const sim02 = cosine(vecs[0], vecs[2]);

    // Similar Korean sentences should have higher similarity
    expect(sim01).toBeGreaterThan(sim02);
    expect(sim01).toBeGreaterThan(0.5);
  });

  it("handles Korean-English mixed text", async () => {
    const vec = await embedder.embedOne(
      "Context Curator는 최적의 컨텍스트를 조립한다",
    );
    expect(vec).toHaveLength(384);
  });
});

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
