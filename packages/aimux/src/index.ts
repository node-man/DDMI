/**
 * aimux — AI CLI multiplexer
 *
 * Route prompts to Claude, Codex, Gemini, Ollama with fallback chain.
 * CLI-first: uses existing CLI tool subscriptions ($0 extra).
 */

// Types
export type {
  AIProvider,
  EmbeddingProvider,
  DegradationLevel,
  RouterConfig,
  RateLimiterConfig,
  RateLimiterStats,
  RateLimiter,
  AILogEntry,
} from "./types.js";

// Providers
export { createCLIProvider, detectCLITools, setRateLimiter, cleanupProcesses } from "./providers/cli-subprocess.js";
export { createOllamaProvider, setOllamaRateLimiter } from "./providers/ollama.js";
export { createTransformersProvider } from "./providers/transformers.js";

// Router
export { createRouter, type AIRouter } from "./router.js";

// Rate limiter
export { createRateLimiter } from "./rate-limiter.js";

// Logger
export { initAILogger, logAICall, getLogPath } from "./logger.js";

// Utils
export { extractJSON } from "./utils.js";
