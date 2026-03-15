/**
 * AI Worker queue tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { createWorker } from "./queue.js";
import {
  initDatabase,
  enqueueTask,
  getPendingTaskCount,
  reclaimStaleTasks,
  dequeueTasks,
} from "../storage/sqlite.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/queue");

function testDb() {
  const dir = join(TEST_DIR, randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.db");
  return initDatabase(dbPath);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("AIWorker", () => {
  it("provider 없으면 processOne이 false 반환", async () => {
    const db = testDb();
    const worker = createWorker(db, null);
    expect(await worker.processOne()).toBe(false);
  });

  it("큐가 비었으면 processOne이 false 반환", async () => {
    const db = testDb();
    const mockProvider = {
      name: "mock",
      chat: async () => "ok",
      chatJSON: async <T>() => ({} as T),
      healthCheck: async () => true,
    };
    const worker = createWorker(db, mockProvider);
    expect(await worker.processOne()).toBe(false);
  });

  it("pendingCount가 큐 상태를 반영한다", () => {
    const db = testDb();
    const worker = createWorker(db, null);

    expect(worker.pendingCount()).toBe(0);

    enqueueTask(db, {
      id: "t1", taskType: "conflict_detection", priority: "batch",
      payload: { aId: "a", bId: "b", aContent: "x", bContent: "y" },
    });

    expect(worker.pendingCount()).toBe(1);
  });

  it("stale 태스크를 복구한다", () => {
    const db = testDb();

    enqueueTask(db, {
      id: "t1", taskType: "conflict_detection", priority: "batch",
      payload: { aId: "a", bId: "b" },
    });

    // dequeue → running
    dequeueTasks(db, 1, "worker-1");
    expect(getPendingTaskCount(db)).toBe(0);

    // started_at을 10분 전으로 조작
    db.prepare("UPDATE ai_task_queue SET started_at = ? WHERE id = 't1'")
      .run(new Date(Date.now() - 10 * 60 * 1000).toISOString());

    const reclaimed = reclaimStaleTasks(db, 2);
    expect(reclaimed).toBe(1);
    expect(getPendingTaskCount(db)).toBe(1);
  });

  it("start/stop이 에러 없이 동작한다", () => {
    const db = testDb();
    const worker = createWorker(db, null, { pollIntervalMs: 60000 });
    worker.start();
    worker.stop();
    // 두 번 stop해도 에러 없음
    worker.stop();
  });
});
