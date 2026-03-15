/**
 * Feedback storage tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { initDatabase, saveFeedback } from "../storage/sqlite.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/feedback");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("Feedback", () => {
  it("피드백을 저장하고 ID를 반환한다", () => {
    const db = initDatabase(join(TEST_DIR, `${randomUUID().slice(0, 8)}.db`));

    const record = saveFeedback(db, "token-123", {
      feedbackToken: "token-123",
      outcome: "helpful",
      blocksUsed: ["a.md#sec1"],
    }, {
      intent: "test query",
      taskType: "research",
      blocksServed: ["a.md#sec1", "b.md#sec2"],
      scoringWeights: { semanticSim: 0.55, keywordBoost: 0.15, taskAwareAuthority: 0.15, recency: 0.15, redundancyPenalty: 1.5 },
    });

    expect(record.id).toMatch(/^FB-/);
    expect(record.outcome).toBe("helpful");
    expect(record.intent).toBe("test query");
    db.close();
  });

  it("여러 피드백을 저장해도 ID가 고유하다", () => {
    const db = initDatabase(join(TEST_DIR, `${randomUUID().slice(0, 8)}.db`));
    const meta = {
      intent: "q", taskType: "research", blocksServed: [],
      scoringWeights: { semanticSim: 0.55, keywordBoost: 0.15, taskAwareAuthority: 0.15, recency: 0.15, redundancyPenalty: 1.5 },
    };

    const r1 = saveFeedback(db, "t1", { feedbackToken: "t1", outcome: "helpful" }, meta);
    const r2 = saveFeedback(db, "t2", { feedbackToken: "t2", outcome: "irrelevant" }, meta);

    expect(r1.id).not.toBe(r2.id);
    db.close();
  });
});
