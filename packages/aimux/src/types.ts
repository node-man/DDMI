/**
 * aimux — AI provider type definitions
 *
 * ddmi에서 추출한 AI 관련 인터페이스.
 * aimux는 ddmi types.ts에 의존하지 않는다 — 완전히 독립적.
 */

// ─── Provider Interfaces ────────────────────────────────

export interface AIProvider {
  name: string;
  chat(prompt: string): Promise<string>;
  chatJSON<T>(prompt: string): Promise<T>;
  healthCheck(): Promise<boolean>;
}

export interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;
  healthCheck(): Promise<boolean>;
}

// ─── Degradation ────────────────────────────────────────

/** Level 0: offline, Level 1: embedding only, Level 2: full LLM */
export type DegradationLevel = 0 | 1 | 2;

// ─── Router Config ──────────────────────────────────────

export interface RouterConfig {
  defaultProvider: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  embeddingModel?: string;
}

// ─── Rate Limiter ───────────────────────────────────────

export interface RateLimiterConfig {
  maxPerMinute: number;
  maxPerSession: number;
  warnTokenThreshold: number;
}

export interface RateLimiterStats {
  sessionTotal: number;
  lastMinuteCount: number;
  perProvider: Record<string, number>;
}

export interface RateLimiter {
  /** 호출 전에 반드시 실행. 제한 초과 시 Error throw. */
  check(provider: string, estimatedTokens: number): void;
  /** 호출 완료 후 기록. */
  record(provider: string): void;
  /** 현재 상태 조회. */
  stats(): RateLimiterStats;
}

// ─── Logger ─────────────────────────────────────────────

export interface AILogEntry {
  provider: string;
  taskType: string;
  prompt: string;
  response: string;
  durationMs: number;
  success: boolean;
  error?: string;
}
