/**
 * AI Router — 태스크별 프로바이더 라우팅
 *
 * CLI-first 전략: CLI → Ollama → 없으면 Level 1 (LLM 없이 동작).
 * healthCheck()로 실행 시점에 사용 가능한 프로바이더를 검증한다.
 */

import type {
  AIProvider,
  EmbeddingProvider,
  AITaskType,
  DegradationLevel,
  DdmiConfig,
} from "../types.js";
import { createCLIProvider, detectCLITools, setRateLimiter, cleanupProcesses } from "./providers/cli-subprocess.js";
import { createOllamaProvider, setOllamaRateLimiter } from "./providers/ollama.js";
import { createTransformersProvider } from "./providers/transformers.js";
import { createRateLimiter } from "./rate-limiter.js";

export interface AIRouter {
  getProvider(taskType?: AITaskType): AIProvider | null;
  getEmbeddingProvider(): EmbeddingProvider;
  getAvailableProviders(): string[];
  getDegradationLevel(): DegradationLevel;
  /** 종료 시 호출 — 남은 CLI 프로세스 정리 */
  shutdown(): void;
}

export async function createRouter(config: DdmiConfig): Promise<AIRouter> {
  // 0. Rate limiter — 모든 provider가 공유
  const rateLimiter = createRateLimiter({
    maxPerMinute: 10,
    maxPerSession: 100,
  });
  setRateLimiter(rateLimiter);
  setOllamaRateLimiter(rateLimiter);

  // 1. Initialize embedding provider (always available)
  const embeddingProvider = await createTransformersProvider(
    config.embedding.model,
  );

  // 2. Detect AI providers
  // 사용자가 명시하면 해당 provider 우선, "auto"면 전부 감지
  const aiProviders: AIProvider[] = [];
  const providerNames: string[] = [];
  const pref = config.ai.defaultProvider;

  // 특정 CLI 도구 명시: "claude", "codex", "gemini", "llm"
  const cliToolNames = ["claude", "codex", "gemini", "llm"];
  if (cliToolNames.includes(pref)) {
    // 사용자가 명시한 CLI 도구를 1순위로
    const provider = createCLIProvider(pref);
    if (await provider.healthCheck()) {
      aiProviders.push(provider);
      providerNames.push(`cli:${pref}`);
    }
  }

  // Ollama
  if (pref === "auto" || pref === "ollama") {
    const ollama = createOllamaProvider(config.ai.ollamaUrl, config.ai.ollamaModel);
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
      if (providerNames.includes(name)) continue; // 중복 방지
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
    getProvider(_taskType?: AITaskType): AIProvider | null {
      if (aiProviders.length === 0) return null;
      // For now, return the first available provider
      // Future: task-based routing with taskOverrides
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
