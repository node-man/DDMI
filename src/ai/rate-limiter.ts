/**
 * AI Rate Limiter — aimux에서 re-export
 *
 * 기존 코드 호환을 위해 유지. 실제 구현은 aimux 패키지.
 */

export { createRateLimiter } from "aimux";
export type { RateLimiter, RateLimiterConfig, RateLimiterStats } from "aimux";
