/**
 * context_feedback MCP tool tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { handleContextFeedback, TOOL_SCHEMA } from "./context-feedback.js";
import { initDatabase } from "../../storage/sqlite.js";

const TEST_DIR = join(import.meta.dirname, "../../../.test-tmp/feedback-tool");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("context_feedback", () => {
  it("TOOL_SCHEMA가 올바른 구조를 가진다", () => {
    expect(TOOL_SCHEMA.name).toBe("context_feedback");
    expect(TOOL_SCHEMA.inputSchema.required).toContain("feedback_token");
    expect(TOOL_SCHEMA.inputSchema.required).toContain("outcome");
  });

  it("피드백을 저장한다", async () => {
    const db = initDatabase(join(TEST_DIR, `${randomUUID().slice(0, 8)}.db`));

    const result = await handleContextFeedback(db, {
      feedback_token: "test-token",
      outcome: "helpful",
      blocks_used: ["a.md#sec1"],
    });

    expect(result.content[0].text).toContain("recorded");
    db.close();
  });
});
