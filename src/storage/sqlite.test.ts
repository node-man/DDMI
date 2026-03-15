import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  initDatabase,
  upsertFile,
  getFileByPath,
  getFileByChecksum,
  getAllFiles,
  deleteFile,
  insertChunks,
  getChunksByFileId,
  deleteChunksByFileId,
  getChunkCount,
  getFileCount,
  saveFeedback,
  withinTransaction,
} from "./sqlite.js";
import type { FileRecord, ChunkRecord, ScoringWeights } from "../types.js";
import type Database from "better-sqlite3";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/sqlite");
let testCounter = 0;

function testDbPath(): string {
  testCounter++;
  return join(TEST_DIR, `test-${testCounter}.db`);
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  const now = new Date().toISOString();
  return {
    id: "file-001",
    path: "docs/test.md",
    title: "Test Document",
    docType: "spec",
    frontmatter: { tags: ["test"] },
    checksum: "abc123",
    totalTokens: 100,
    completenessScore: 0.5,
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    ...overrides,
  };
}

function makeChunk(
  fileId: string,
  id: string,
  overrides: Partial<ChunkRecord> = {},
): ChunkRecord {
  return {
    id,
    fileId,
    sectionPath: "## Test Section",
    content: "This is test content for the chunk.",
    tokenCount: 12,
    headingLevel: 2,
    chunkType: "prose",
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SQLite Storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = initDatabase(testDbPath());
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
  });

  describe("initDatabase", () => {
    it("creates database with WAL mode", () => {
      const mode = db.pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");
    });

    it("creates files table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it("creates chunks table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it("creates feedback_log table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_log'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  describe("files CRUD", () => {
    it("upserts and retrieves a file", () => {
      const file = makeFile();
      upsertFile(db, file);

      const retrieved = getFileByPath(db, "docs/test.md");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("file-001");
      expect(retrieved!.title).toBe("Test Document");
      expect(retrieved!.docType).toBe("spec");
      expect(retrieved!.frontmatter).toEqual({ tags: ["test"] });
    });

    it("updates existing file on conflict", () => {
      upsertFile(db, makeFile({ title: "V1" }));
      upsertFile(db, makeFile({ title: "V2", checksum: "def456" }));

      const retrieved = getFileByPath(db, "docs/test.md");
      expect(retrieved!.title).toBe("V2");
      expect(retrieved!.checksum).toBe("def456");
    });

    it("gets checksum for change detection", () => {
      upsertFile(db, makeFile());
      expect(getFileByChecksum(db, "docs/test.md")).toBe("abc123");
      expect(getFileByChecksum(db, "nonexistent.md")).toBeNull();
    });

    it("lists all files", () => {
      upsertFile(db, makeFile({ id: "f1", path: "a.md" }));
      upsertFile(db, makeFile({ id: "f2", path: "b.md" }));
      expect(getAllFiles(db)).toHaveLength(2);
    });

    it("deletes file and cascades chunks", () => {
      upsertFile(db, makeFile());
      insertChunks(db, [makeChunk("file-001", "c1"), makeChunk("file-001", "c2")]);

      expect(getChunkCount(db)).toBe(2);
      deleteFile(db, "file-001");
      expect(getFileCount(db)).toBe(0);
      expect(getChunkCount(db)).toBe(0);
    });
  });

  describe("chunks CRUD", () => {
    it("inserts and retrieves chunks", () => {
      upsertFile(db, makeFile());
      const chunks = [
        makeChunk("file-001", "c1", { sectionPath: "## Intro" }),
        makeChunk("file-001", "c2", { sectionPath: "## Details" }),
      ];
      insertChunks(db, chunks);

      const retrieved = getChunksByFileId(db, "file-001");
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].sectionPath).toBe("## Intro");
    });

    it("deletes chunks by file ID", () => {
      upsertFile(db, makeFile());
      insertChunks(db, [makeChunk("file-001", "c1")]);
      deleteChunksByFileId(db, "file-001");
      expect(getChunksByFileId(db, "file-001")).toHaveLength(0);
    });
  });

  describe("feedback", () => {
    it("saves and generates feedback ID", () => {
      const weights: ScoringWeights = {
        semanticSim: 0.55,
        keywordBoost: 0.15,
        taskAwareAuthority: 0.15,
        recency: 0.15,
        redundancyPenalty: 1.5,
      };

      const record = saveFeedback(db, "tok-123", {
        feedbackToken: "tok-123",
        outcome: "helpful",
        blocksUsed: ["docs/spec.md"],
      }, {
        intent: "implement cache",
        taskType: "implementation",
        blocksServed: ["docs/spec.md", "docs/adr.md"],
        scoringWeights: weights,
      });

      expect(record.id).toMatch(/^FB-\d{8}-\d{3}$/);
      expect(record.outcome).toBe("helpful");
    });
  });

  describe("transaction", () => {
    it("commits on success", () => {
      withinTransaction(db, () => {
        upsertFile(db, makeFile({ id: "f1", path: "a.md" }));
        upsertFile(db, makeFile({ id: "f2", path: "b.md" }));
      });
      expect(getFileCount(db)).toBe(2);
    });

    it("rolls back on error", () => {
      expect(() =>
        withinTransaction(db, () => {
          upsertFile(db, makeFile({ id: "f1", path: "a.md" }));
          throw new Error("intentional");
        }),
      ).toThrow("intentional");
      expect(getFileCount(db)).toBe(0);
    });
  });
});
