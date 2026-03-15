/**
 * Relation Engine tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { createRelationEngine } from "./relations.js";
import {
  initDatabase,
  upsertFile,
  insertChunks,
  insertRelations,
  insertConflict,
  getOpenConflicts,
  getRelationCount,
  enqueueTask,
  dequeueTasks,
  completeTask,
  reclaimStaleTasks,
  getPendingTaskCount,
} from "../storage/sqlite.js";
import type { FileRecord, ChunkRecord, ExplicitLink, Relation, Conflict, AIProvider } from "../types.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/relations");

function testDbPath(): string {
  return join(TEST_DIR, `test-${randomUUID()}.db`);
}

function makeFile(id: string, path: string): FileRecord {
  return {
    id, path, title: path, docType: "spec", frontmatter: {},
    checksum: "abc", totalTokens: 100, completenessScore: 0,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", indexedAt: "2026-01-01",
  };
}

function makeChunk(id: string, fileId: string, section: string, content: string): ChunkRecord {
  return {
    id, fileId, sectionPath: section, content,
    tokenCount: 50, headingLevel: 2, chunkType: "prose",
    metadata: {}, createdAt: "2026-01-01",
  };
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("RelationEngine", () => {
  describe("extractExplicitLinks", () => {
    it("markdown link에서 references 관계를 추출한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      upsertFile(db, makeFile("f1", "specs/api.md"));
      upsertFile(db, makeFile("f2", "specs/cache.md"));
      insertChunks(db, [
        makeChunk("c1", "f1", "## API", "API 설계. See [cache](specs/cache.md)"),
        makeChunk("c2", "f2", "## Cache", "캐시 전략"),
      ]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      const links: ExplicitLink[] = [{
        type: "markdown",
        target: "specs/cache.md",
        text: "cache",
        sourceSection: "## API",
      }];

      const allFileIds = new Map([["specs/api.md", "f1"], ["specs/cache.md", "f2"]]);
      const relations = engine.extractExplicitLinks("f1", links, allFileIds);

      expect(relations).toHaveLength(1);
      expect(relations[0].relationType).toBe("references");
      expect(relations[0].sourceChunkId).toBe("c1");
      expect(relations[0].targetChunkId).toBe("c2");
      expect(relations[0].extractionMethod).toBe("explicit");
      expect(relations[0].confidence).toBe(1.0);
    });

    it("자기 자신에 대한 링크는 무시한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);
      upsertFile(db, makeFile("f1", "specs/api.md"));
      insertChunks(db, [makeChunk("c1", "f1", "## API", "Self ref")]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      const links: ExplicitLink[] = [{
        type: "markdown",
        target: "specs/api.md",
        text: "self",
        sourceSection: "## API",
      }];

      const relations = engine.extractExplicitLinks("f1", links, new Map([["specs/api.md", "f1"]]));
      expect(relations).toHaveLength(0);
    });

    it("존재하지 않는 파일로의 링크는 무시한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);
      upsertFile(db, makeFile("f1", "specs/api.md"));
      insertChunks(db, [makeChunk("c1", "f1", "## API", "content")]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      const links: ExplicitLink[] = [{
        type: "markdown",
        target: "nonexistent.md",
        text: "missing",
        sourceSection: "## API",
      }];

      const relations = engine.extractExplicitLinks("f1", links, new Map([["specs/api.md", "f1"]]));
      expect(relations).toHaveLength(0);
    });
  });

  describe("getRelations / getConflicts / resolve", () => {
    it("관계 조회가 동작한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      const rel: Relation = {
        id: "r1", sourceChunkId: "c1", targetChunkId: "c2",
        relationType: "references", confidence: 1.0,
        extractionMethod: "explicit", metadata: {},
        createdAt: "2026-01-01",
      };
      insertRelations(db, [rel]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      expect(engine.getRelations("c1")).toHaveLength(1);
      expect(engine.getRelations("c2")).toHaveLength(1); // target도 조회됨
      expect(engine.getRelations("c3")).toHaveLength(0);
    });

    it("충돌 조회 + 해결이 동작한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      const conflict: Conflict = {
        id: "cf1", chunkAId: "c1", chunkBId: "c2",
        severity: "high", description: "모순 발견",
        status: "open", detectedAt: "2026-01-01",
      };
      insertConflict(db, conflict);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      expect(engine.getConflicts()).toHaveLength(1);
      expect(engine.stats().openConflicts).toBe(1);

      engine.resolve("cf1", "human", "수동 확인 완료");
      expect(engine.getConflicts()).toHaveLength(0);
      expect(engine.stats().openConflicts).toBe(0);
    });
  });

  describe("stats", () => {
    it("관계 수와 충돌 수를 반환한다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);
      insertRelations(db, [{
        id: "r1", sourceChunkId: "c1", targetChunkId: "c2",
        relationType: "references", confidence: 1.0,
        extractionMethod: "explicit", metadata: {},
        createdAt: "2026-01-01",
      }]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      const s = engine.stats();
      expect(s.relations).toBe(1);
      expect(s.openConflicts).toBe(0);
    });
  });

  // ─── 회귀 테스트 (PR #1 리뷰 대응) ────────────────────

  describe("incremental: skip된 파일도 링크 target으로 resolve", () => {
    it("allFileIds에 skip된 파일이 포함되면 링크가 resolve된다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      // f1 (변경됨), f2 (skip됨 — 이미 인덱싱됨)
      upsertFile(db, makeFile("f1", "docs/changed.md"));
      upsertFile(db, makeFile("f2", "docs/unchanged.md"));
      insertChunks(db, [
        makeChunk("c1", "f1", "## Changed", "See [unchanged](docs/unchanged.md)"),
        makeChunk("c2", "f2", "## Unchanged", "기존 내용"),
      ]);
      db.close();

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: null,
      });

      // allFileIds에 f2 (skip된 파일)도 포함 — 이게 핵심
      const allFileIds = new Map([
        ["docs/changed.md", "f1"],
        ["docs/unchanged.md", "f2"],  // skip됐지만 target으로 필요
      ]);

      const links: ExplicitLink[] = [{
        type: "markdown",
        target: "docs/unchanged.md",
        text: "unchanged",
        sourceSection: "## Changed",
      }];

      const rels = engine.extractExplicitLinks("f1", links, allFileIds);
      expect(rels).toHaveLength(1);
      expect(rels[0].targetChunkId).toBe("c2");
    });
  });

  describe("queue: 1 pair = 1 task", () => {
    it("개별 태스크로 enqueue하고 각각 dequeue된다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      // 3쌍 → 3태스크
      for (let i = 0; i < 3; i++) {
        enqueueTask(db, {
          id: `task-${i}`,
          taskType: "conflict_detection",
          priority: "batch",
          payload: { aId: `c${i}a`, bId: `c${i}b`, aContent: "A", bContent: "B" },
        });
      }

      expect(getPendingTaskCount(db)).toBe(3);

      // 1개씩 dequeue
      const t1 = dequeueTasks(db, 1, "worker-1");
      expect(t1).toHaveLength(1);
      expect(getPendingTaskCount(db)).toBe(2);

      const t2 = dequeueTasks(db, 1, "worker-2");
      expect(t2).toHaveLength(1);
      expect(t2[0].id).not.toBe(t1[0].id); // 다른 태스크

      db.close();
    });
  });

  describe("queue: stale running 태스크 복구", () => {
    it("2분 초과 running 태스크가 pending으로 복구된다", () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);

      enqueueTask(db, {
        id: "stale-1",
        taskType: "conflict_detection",
        priority: "batch",
        payload: { aId: "a", bId: "b" },
      });

      // dequeue → running
      const tasks = dequeueTasks(db, 1, "worker-1");
      expect(tasks).toHaveLength(1);
      expect(getPendingTaskCount(db)).toBe(0);

      // started_at을 10분 전으로 조작
      db.prepare(
        "UPDATE ai_task_queue SET started_at = ? WHERE id = 'stale-1'",
      ).run(new Date(Date.now() - 10 * 60 * 1000).toISOString());

      // reclaim
      const reclaimed = reclaimStaleTasks(db, 2);
      expect(reclaimed).toBe(1);
      expect(getPendingTaskCount(db)).toBe(1);

      // 다시 dequeue 가능
      const retried = dequeueTasks(db, 1, "worker-2");
      expect(retried).toHaveLength(1);
      expect(retried[0].workerId).toBe("worker-2");

      db.close();
    });
  });

  describe("detectConflictsAI: 에러 전파", () => {
    it("LLM 실패 시 에러를 throw한다 (silent return 아님)", async () => {
      const dbPath = testDbPath();
      const db = initDatabase(dbPath);
      db.close();

      const failingProvider: AIProvider = {
        name: "mock-fail",
        async chat() { throw new Error("LLM timeout"); },
        async chatJSON() { throw new Error("LLM timeout"); },
        async healthCheck() { return true; },
      };

      const engine = createRelationEngine({
        dbPath, embedder: null, lance: null, aiProvider: failingProvider,
      });

      await expect(
        engine.detectConflictsAI([{
          aId: "c1", aContent: "X says yes",
          bId: "c2", bContent: "Y says no",
        }]),
      ).rejects.toThrow("LLM timeout");
    });
  });
});
