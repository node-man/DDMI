/**
 * Config loader tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { DEFAULT_CONFIG } from "../types.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/config");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("loadConfig", () => {
  it("config.toml 없으면 DEFAULT_CONFIG 반환", () => {
    const config = loadConfig(join(TEST_DIR, "nonexistent"));
    expect(config.curator.weights.semanticSim).toBe(0.55);
    expect(config.server.name).toBe("ddmi");
  });

  it("config.toml에서 가중치를 읽는다", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(join(dir, ".ddmi"), { recursive: true });
    writeFileSync(join(dir, ".ddmi", "config.toml"), `
[curator.weights]
semantic_sim = 0.30
keyword_boost = 0.40
`, "utf-8");

    const config = loadConfig(dir);
    expect(config.curator.weights.semanticSim).toBe(0.30);
    expect(config.curator.weights.keywordBoost).toBe(0.40);
    // 미지정 값은 기본값 유지
    expect(config.curator.weights.recency).toBe(0.15);
  });

  it("ai 섹션을 읽는다", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(join(dir, ".ddmi"), { recursive: true });
    writeFileSync(join(dir, ".ddmi", "config.toml"), `
[ai]
default_provider = "claude"
ollama_model = "llama3"
`, "utf-8");

    const config = loadConfig(dir);
    expect(config.ai.defaultProvider).toBe("claude");
    expect(config.ai.ollamaModel).toBe("llama3");
  });

  it("부분적으로 정의된 값만 오버라이드", () => {
    const dir = join(TEST_DIR, randomUUID().slice(0, 8));
    mkdirSync(join(dir, ".ddmi"), { recursive: true });
    writeFileSync(join(dir, ".ddmi", "config.toml"), `
[server]
name = "custom"
`, "utf-8");

    const config = loadConfig(dir);
    expect(config.server.name).toBe("custom");
    expect(config.server.transport).toBe("stdio"); // 기본값 유지
  });
});
