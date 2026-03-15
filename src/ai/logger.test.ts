/**
 * AI Logger tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { initAILogger, logAICall, getLogPath } from "./logger.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/logger");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("AI Logger", () => {
  it("JSONL 형식으로 로그를 기록한다", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(dir, { recursive: true });
    initAILogger(dir);

    logAICall({
      provider: "test", taskType: "chat",
      prompt: "hello", response: "world",
      durationMs: 100, success: true,
    });

    const content = readFileSync(join(dir, "ai.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.provider).toBe("test");
    expect(parsed.prompt).toBe("hello");
    expect(parsed.response).toBe("world");
    expect(parsed.success).toBe(true);
  });

  it("에러 정보를 기록한다", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(dir, { recursive: true });
    initAILogger(dir);

    logAICall({
      provider: "test", taskType: "chat",
      prompt: "p", response: "",
      durationMs: 50, success: false, error: "timeout",
    });

    const content = readFileSync(join(dir, "ai.log"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("timeout");
  });

  it("여러 줄이 append된다", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(dir, { recursive: true });
    initAILogger(dir);

    logAICall({ provider: "a", taskType: "c", prompt: "1", response: "1", durationMs: 1, success: true });
    logAICall({ provider: "b", taskType: "c", prompt: "2", response: "2", durationMs: 2, success: true });

    const lines = readFileSync(join(dir, "ai.log"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
