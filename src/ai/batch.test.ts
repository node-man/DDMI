/**
 * AI Batch Engine tests — 배치 분할, 프롬프트 생성, provider별 크기
 */

import { describe, it, expect } from "vitest";
import {
  splitIntoBatches,
  buildBatchPrompt,
  buildCrossRelationPrompt,
  getBatchSize,
  type FileSummary,
  type SimilarPair,
} from "./batch.js";

function makeFiles(count: number): FileSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `docs/file-${i}.md`,
    fileId: `fid-${i}`,
    docType: i % 3 === 0 ? "unknown" : "spec",
    summary: `Content of file ${i}`,
  }));
}

// ─── getBatchSize ────────────────────────────────────────

describe("getBatchSize", () => {
  it("ollama → 10", () => {
    expect(getBatchSize("ollama:qwen3.5:9b")).toBe(10);
  });

  it("cli:claude → 50", () => {
    expect(getBatchSize("cli:claude")).toBe(50);
  });

  it("cli:codex → 50", () => {
    expect(getBatchSize("cli:codex")).toBe(50);
  });

  it("cli:gemini → 50", () => {
    expect(getBatchSize("cli:gemini")).toBe(50);
  });

  it("unknown provider → 50 (default)", () => {
    expect(getBatchSize("some-new-provider")).toBe(50);
  });
});

// ─── splitIntoBatches ────────────────────────────────────

describe("splitIntoBatches", () => {
  it("18파일을 ollama 배치(10)로 2개로 나눈다", () => {
    const files = makeFiles(18);
    const batches = splitIntoBatches(files, [], "ollama:qwen3.5:9b", new Set());

    expect(batches).toHaveLength(2);
    expect(batches[0].files).toHaveLength(10);
    expect(batches[1].files).toHaveLength(8);
  });

  it("18파일을 claude 배치(50)로 1개로 유지한다", () => {
    const files = makeFiles(18);
    const batches = splitIntoBatches(files, [], "cli:claude", new Set());

    expect(batches).toHaveLength(1);
    expect(batches[0].files).toHaveLength(18);
  });

  it("100파일을 ollama 배치(10)로 10개로 나눈다", () => {
    const files = makeFiles(100);
    const batches = splitIntoBatches(files, [], "ollama:qwen3.5:9b", new Set());

    expect(batches).toHaveLength(10);
    expect(batches.every((b) => b.files.length === 10)).toBe(true);
  });

  it("500파일을 claude 배치(50)로 10개로 나눈다", () => {
    const files = makeFiles(500);
    const batches = splitIntoBatches(files, [], "cli:claude", new Set());

    expect(batches).toHaveLength(10);
  });

  it("변경 파일을 첫 배치에 우선 배치한다", () => {
    const files = makeFiles(20);
    const changed = new Set(["docs/file-15.md", "docs/file-19.md"]);

    const batches = splitIntoBatches(files, [], "ollama:qwen3.5:9b", changed);

    // 첫 배치에 변경 파일이 포함되어야 함
    const firstBatchPaths = batches[0].files.map((f) => f.path);
    expect(firstBatchPaths).toContain("docs/file-15.md");
    expect(firstBatchPaths).toContain("docs/file-19.md");
  });

  it("변경 파일이 배치 크기보다 많으면 여러 배치에 분산", () => {
    const files = makeFiles(30);
    const changed = new Set(
      Array.from({ length: 15 }, (_, i) => `docs/file-${i + 15}.md`),
    );

    const batches = splitIntoBatches(files, [], "ollama:qwen3.5:9b", changed);

    // 15개 변경 파일 → 첫 2배치(10+5)에 모두 포함
    const first10 = batches[0].files.map((f) => f.path);
    const second10 = batches[1].files.map((f) => f.path);
    const allChanged = [...first10, ...second10];
    for (const p of changed) {
      expect(allChanged).toContain(p);
    }
  });

  it("빈 파일 목록 → 빈 배치", () => {
    const batches = splitIntoBatches([], [], "cli:claude", new Set());
    expect(batches).toHaveLength(0);
  });

  it("1개 파일 → 1개 배치", () => {
    const batches = splitIntoBatches(makeFiles(1), [], "ollama:qwen3.5:9b", new Set());
    expect(batches).toHaveLength(1);
    expect(batches[0].files).toHaveLength(1);
  });
});

// ─── buildBatchPrompt ────────────────────────────────────

describe("buildBatchPrompt", () => {
  it("파일 요약이 프롬프트에 포함된다", () => {
    const batch = {
      files: makeFiles(3),
      pairs: [],
    };

    const prompt = buildBatchPrompt(batch, 18);

    expect(prompt).toContain("docs/file-0.md");
    expect(prompt).toContain("docs/file-1.md");
    expect(prompt).toContain("docs/file-2.md");
    expect(prompt).toContain("3 markdown files");
    expect(prompt).toContain("batch from 18 total");
  });

  it("JSON 형식 예시가 포함된다", () => {
    const batch = { files: makeFiles(2), pairs: [] };
    const prompt = buildBatchPrompt(batch, 10);

    expect(prompt).toContain('"classifications"');
    expect(prompt).toContain('"relations"');
    expect(prompt).toContain('"conflicts"');
    expect(prompt).toContain("Example response");
  });

  it("unknown docType 파일이 표시된다", () => {
    const batch = {
      files: [{ path: "a.md", fileId: "f1", docType: "unknown", summary: "test" }],
      pairs: [],
    };
    const prompt = buildBatchPrompt(batch, 1);

    expect(prompt).toContain("[unknown]");
  });
});

// ─── buildCrossRelationPrompt ────────────────────────────

describe("buildCrossRelationPrompt", () => {
  it("유사 쌍이 프롬프트에 포함된다", () => {
    const pairs: SimilarPair[] = [
      { aId: "c1", aContent: "Content A", bId: "c2", bContent: "Content B" },
    ];

    const prompt = buildCrossRelationPrompt(pairs);

    expect(prompt).toContain("Content A");
    expect(prompt).toContain("Content B");
    expect(prompt).toContain("Pair 0");
  });

  it("20개 초과 시 캡 적용", () => {
    const pairs: SimilarPair[] = Array.from({ length: 30 }, (_, i) => ({
      aId: `a${i}`, aContent: `A${i}`, bId: `b${i}`, bContent: `B${i}`,
    }));

    const prompt = buildCrossRelationPrompt(pairs);

    // Pair 19까지만 포함 (0-indexed, 20개)
    expect(prompt).toContain("Pair 19");
    expect(prompt).not.toContain("Pair 20");
  });

  it("빈 쌍 → 빈 프롬프트는 아니지만 쌍 없음", () => {
    const prompt = buildCrossRelationPrompt([]);
    expect(prompt).toContain("relationships and conflicts");
  });
});
