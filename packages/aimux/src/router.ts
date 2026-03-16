/**
 * AI Router — 태스크별 프로바이더 라우팅
 *
 * CLI-first 전략: CLI → Ollama → 없으면 Level 1 (LLM 없이 동작).
 * healthCheck()로 실행 시점에 사용 가능한 프로바이더를 검증한다.
 */

import type {
  AIProvider,
  EmbeddingProvider,
  DegradationLevel,
  RouterConfig,
} from "./types.js";
import { createCLIProvider, detectCLITools, setRateLimiter, cleanupProcesses } from "./providers/cli-subprocess.js";
import { createOllamaProvider, setOllamaRateLimiter } from "./providers/ollama.js";
import { createTransformersProvider } from "./providers/transformers.js";
import { createRateLimiter } from "./rate-limiter.js";

export interface AIRouter {
  getProvider(taskType?: string): AIProvider | null;
  getEmbeddingProvider(): EmbeddingProvider;
  getAvailableProviders(): string[];
  getDegradationLevel(): DegradationLevel;
  /** 종료 시 호출 — 남은 CLI 프로세스 정리 */
  shutdown(): void;
}

export async function createRouter(
  config: RouterConfig,
  options?: { existingEmbedder?: EmbeddingProvider },
): Promise<AIRouter> {
  // 0. Rate limiter — 모든 provider가 공유
  const rateLimiter = createRateLimiter({
    maxPerMinute: 10,
    maxPerSession: 100,
  });
  setRateLimiter(rateLimiter);
  setOllamaRateLimiter(rateLimiter);

  // 1. Initialize embedding provider (reuse if provided)
  const embeddingProvider = options?.existingEmbedder
    ?? await createTransformersProvider(config.embeddingModel);

  // 2. Detect AI providers
  const aiProviders: AIProvider[] = [];
  const providerNames: string[] = [];
  const pref = config.defaultProvider;

  // 특정 CLI 도구 명시: "claude", "codex", "gemini", "llm"
  const cliToolNames = ["claude", "codex", "gemini", "llm"];
  if (cliToolNames.includes(pref)) {
    const provider = createCLIProvider(pref);
    if (await provider.healthCheck()) {
      aiProviders.push(provider);
      providerNames.push(`cli:${pref}`);
    }
  }

  // Ollama
  if (pref === "auto" || pref === "ollama") {
    const ollama = createOllamaProvider(config.ollamaUrl, config.ollamaModel);
    if (await ollama.healthCheck()) {
      aiProviders.push(ollama);
      providerNames.push(ollama.name);
    }
  }

  // auto: 나머지 CLI 도구도 감지 (fallback 체인)
  if (pref === "auto") {
    const cliTools = await detectCLITools();
    for (const tool of cliTools) {
      const name = `cli:${tool}`;
      if (providerNames.includes(name)) continue;
      const provider = createCLIProvider(tool);
      if (await provider.healthCheck()) {
        aiProviders.push(provider);
        providerNames.push(name);
      }
    }
  }

  // Determine degradation level
  const level: DegradationLevel = aiProviders.length > 0 ? 2 : 1;

  return {
    getProvider(_taskType?: string): AIProvider | null {
      if (aiProviders.length === 0) return null;
      return aiProviders[0];
    },

    getEmbeddingProvider(): EmbeddingProvider {
      return embeddingProvider;
    },

    getAvailableProviders(): string[] {
      return providerNames;
    },

    getDegradationLevel(): DegradationLevel {
      return level;
    },

    shutdown(): void {
      cleanupProcesses();
    },
  };
}
