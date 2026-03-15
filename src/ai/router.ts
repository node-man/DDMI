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
  // 우선순위: Ollama (상시 worker) → CLI (일회성 fallback)
  const aiProviders: AIProvider[] = [];
  const providerNames: string[] = [];

  // Ollama (priority 1 — 상시 실행 worker, 프로세스 생성 오버헤드 0)
  if (
    config.ai.defaultProvider === "auto" ||
    config.ai.defaultProvider === "ollama"
  ) {
    const ollama = createOllamaProvider(
      config.ai.ollamaUrl,
      config.ai.ollamaModel,
    );
    const healthy = await ollama.healthCheck();
    if (healthy) {
      aiProviders.push(ollama);
      providerNames.push(ollama.name);
    }
  }

  // CLI tools (priority 2 — 호출마다 프로세스 생성/종료, 배치 시에만 사용 권장)
  if (config.ai.defaultProvider === "auto" || config.ai.defaultProvider.startsWith("cli")) {
    const cliTools = await detectCLITools();
    for (const tool of cliTools) {
      const provider = createCLIProvider(tool);
      const healthy = await provider.healthCheck();
      if (healthy) {
        aiProviders.push(provider);
        providerNames.push(`cli:${tool}`);
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
