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
import { createCLIProvider, detectCLITools } from "./providers/cli-subprocess.js";
import { createOllamaProvider } from "./providers/ollama.js";
import { createTransformersProvider } from "./providers/transformers.js";

export interface AIRouter {
  getProvider(taskType?: AITaskType): AIProvider | null;
  getEmbeddingProvider(): EmbeddingProvider;
  getAvailableProviders(): string[];
  getDegradationLevel(): DegradationLevel;
}

export async function createRouter(config: DdmiConfig): Promise<AIRouter> {
  // 1. Initialize embedding provider (always available)
  const embeddingProvider = await createTransformersProvider(
    config.embedding.model,
  );

  // 2. Detect AI providers
  const aiProviders: AIProvider[] = [];
  const providerNames: string[] = [];

  // CLI tools (priority 1)
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

  // Ollama (priority 2)
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
  };
}
