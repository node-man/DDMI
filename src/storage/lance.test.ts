import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initVectorStore,
  upsertVectors,
  searchSimilar,
  deleteByFileId,
  dropAll,
  vectorCount,
} from "./lance.js";
import type { LanceConnection } from "./lance.js";
import type { VectorRecord } from "../types.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/lance");

function lancePath(): string {
  return join(TEST_DIR, `vectors-${randomUUID()}.lance`);
}

function makeVector(
  id: string,
  fileId: string,
  overrides: Partial<VectorRecord> = {},
): VectorRecord {
  // 384-dim vector with a distinct pattern for each id
  const seed = id.charCodeAt(id.length - 1);
  const vector = Array.from({ length: 384 }, (_, i) =>
    Math.sin(seed * 0.1 + i * 0.01),
  );
  // L2 normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  const normalized = vector.map((v) => v / norm);

  return {
    id,
    vector: normalized,
    fileId,
    filePath: `docs/${fileId}.md`,
    sectionPath: "## Test",
    content: `Content for ${id}`,
    docType: "spec",
    date: "2026-03-15",
    tokenCount: 50,
    ...overrides,
  };
}

describe("LanceDB Storage", () => {
  let conn: LanceConnection;

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    conn = await initVectorStore(lancePath());
  });

  afterEach(async () => {
    // LanceDB files are left in TEST_DIR; cleaned up at OS level
  });

  it("initializes with no table", async () => {
    expect(conn.table).toBeNull();
    expect(await vectorCount(conn)).toBe(0);
  });

  it("upserts vectors and creates table", async () => {
    const vectors = [
      makeVector("c1", "file1"),
      makeVector("c2", "file1"),
      makeVector("c3", "file2"),
    ];

    await upsertVectors(conn, vectors);
    expect(await vectorCount(conn)).toBe(3);
  });

  it("searches similar vectors", async () => {
    const v1 = makeVector("c1", "file1");
    const v2 = makeVector("c2", "file1");
    const v3 = makeVector("c3", "file2");

    await upsertVectors(conn, [v1, v2, v3]);

    // Search with v1's own vector — should return v1 as most similar
    const results = await searchSimilar(conn, v1.vector, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("c1");
    expect(results[0].similarity).toBeGreaterThan(0.9);
  });

  it("deletes vectors by file ID", async () => {
    await upsertVectors(conn, [
      makeVector("c1", "file1"),
      makeVector("c2", "file1"),
      makeVector("c3", "file2"),
    ]);

    await deleteByFileId(conn, "file1");
    expect(await vectorCount(conn)).toBe(1);
  });

  it("drops all vectors", async () => {
    await upsertVectors(conn, [makeVector("c1", "file1")]);
    await dropAll(conn);
    expect(conn.table).toBeNull();
    expect(await vectorCount(conn)).toBe(0);
  });

  it("handles empty upsert gracefully", async () => {
    await upsertVectors(conn, []);
    expect(await vectorCount(conn)).toBe(0);
  });

  it("returns empty array when searching empty store", async () => {
    const results = await searchSimilar(conn, Array(384).fill(0), 5);
    expect(results).toEqual([]);
  });
});
