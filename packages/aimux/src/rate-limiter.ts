/**
 * AI Rate Limiter — 외부 API 호출 폭주 방지
 *
 * 3개 레이어:
 * 1. 분당 호출 수 제한 (기본 10회/분)
 * 2. 세션당 총 호출 수 제한 (기본 100회)
 * 3. 비용 추정 경고 (프롬프트 토큰 기반)
 *
 * 제한 초과 시 에러를 던짐 — 조용히 무시하면 안 됨.
 */

import type { RateLimiterConfig, RateLimiter, RateLimiterStats } from "./types.js";

const DEFAULT_RATE_CONFIG: RateLimiterConfig = {
  maxPerMinute: 10,
  maxPerSession: 100,
  warnTokenThreshold: 50000,
};

export type { RateLimiter, RateLimiterConfig, RateLimiterStats };

export function createRateLimiter(
  config: Partial<RateLimiterConfig> = {},
): RateLimiter {
  const cfg = { ...DEFAULT_RATE_CONFIG, ...config };

  const timestamps: number[] = [];
  let sessionTotal = 0;
  const perProvider: Record<string, number> = {};

  return {
    check(provider: string, estimatedTokens: number): void {
      // 1. 세션 총량 체크
      if (sessionTotal >= cfg.maxPerSession) {
        throw new Error(
          `[RATE LIMIT] 세션 호출 한도 초과: ${sessionTotal}/${cfg.maxPerSession}회. ` +
          `ddmi를 재시작하면 카운터가 리셋됩니다. ` +
          `한도 변경: config.toml [ai] max_calls_per_session`,
        );
      }

      // 2. 분당 호출 체크
      const now = Date.now();
      const oneMinuteAgo = now - 60_000;
      // 1분 이전 기록 제거
      while (timestamps.length > 0 && timestamps[0] < oneMinuteAgo) {
        timestamps.shift();
      }
      if (timestamps.length >= cfg.maxPerMinute) {
        throw new Error(
          `[RATE LIMIT] 분당 호출 한도 초과: ${timestamps.length}/${cfg.maxPerMinute}회/분. ` +
          `1분 후 재시도하세요. ` +
          `한도 변경: config.toml [ai] max_calls_per_minute`,
        );
      }

      // 3. 큰 프롬프트 경고
      if (estimatedTokens > cfg.warnTokenThreshold) {
        console.error(
          `[RATE WARN] 대형 프롬프트 감지: ~${estimatedTokens} tokens → ${provider}. ` +
          `비용이 높을 수 있습니다.`,
        );
      }
    },

    record(provider: string): void {
      timestamps.push(Date.now());
      sessionTotal++;
      perProvider[provider] = (perProvider[provider] ?? 0) + 1;
    },

    stats(): RateLimiterStats {
      const now = Date.now();
      const oneMinuteAgo = now - 60_000;
      const lastMinuteCount = timestamps.filter((t) => t >= oneMinuteAgo).length;

      return {
        sessionTotal,
        lastMinuteCount,
        perProvider: { ...perProvider },
      };
    },
  };
}
