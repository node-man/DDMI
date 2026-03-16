/**
 * Rate limiter tests — 호출 폭주 방지 검증
 */

import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
  it("세션 한도 초과 시 에러를 던진다", () => {
    const limiter = createRateLimiter({ maxPerSession: 3, maxPerMinute: 100 });

    limiter.check("test", 100);
    limiter.record("test");
    limiter.check("test", 100);
    limiter.record("test");
    limiter.check("test", 100);
    limiter.record("test");

    expect(() => limiter.check("test", 100)).toThrow("세션 호출 한도 초과");
  });

  it("분당 한도 초과 시 에러를 던진다", () => {
    const limiter = createRateLimiter({ maxPerMinute: 2, maxPerSession: 100 });

    limiter.check("test", 100);
    limiter.record("test");
    limiter.check("test", 100);
    limiter.record("test");

    expect(() => limiter.check("test", 100)).toThrow("분당 호출 한도 초과");
  });

  it("한도 내에서는 정상 동작", () => {
    const limiter = createRateLimiter({ maxPerMinute: 5, maxPerSession: 10 });

    for (let i = 0; i < 5; i++) {
      limiter.check("test", 100);
      limiter.record("test");
    }

    const stats = limiter.stats();
    expect(stats.sessionTotal).toBe(5);
    expect(stats.lastMinuteCount).toBe(5);
    expect(stats.perProvider["test"]).toBe(5);
  });

  it("provider별 호출 수를 추적한다", () => {
    const limiter = createRateLimiter({ maxPerMinute: 100, maxPerSession: 100 });

    limiter.check("cli:claude", 100);
    limiter.record("cli:claude");
    limiter.check("cli:claude", 100);
    limiter.record("cli:claude");
    limiter.check("cli:gemini", 100);
    limiter.record("cli:gemini");

    const stats = limiter.stats();
    expect(stats.perProvider["cli:claude"]).toBe(2);
    expect(stats.perProvider["cli:gemini"]).toBe(1);
    expect(stats.sessionTotal).toBe(3);
  });

  it("대형 프롬프트 경고 (stderr, crash 안 함)", () => {
    const limiter = createRateLimiter({ warnTokenThreshold: 100 });

    // Should not throw, just warn to stderr
    expect(() => limiter.check("test", 200)).not.toThrow();
  });
});
