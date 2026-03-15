/**
 * Ollama Provider — 로컬 LLM 서버
 *
 * Ollama HTTP API를 직접 호출. 외부 의존성 없음 (fetch만 사용).
 * healthCheck는 /api/tags 호출 (LLM 호출 아님, 목록 조회만).
 */

import type { AIProvider } from "../../types.js";
import { extractJSON } from "../utils.js";
import { logAICall } from "../logger.js";
import type { RateLimiter } from "../rate-limiter.js";

let sharedRateLimiter: RateLimiter | null = null;

export function setOllamaRateLimiter(limiter: RateLimiter): void {
  sharedRateLimiter = limiter;
}

export function createOllamaProvider(
  url: string = "http://localhost:11434",
  model: string = "llama3.2",
): AIProvider {
  const providerName = `ollama:${model}`;

  return {
    name: providerName,

    async chat(prompt: string): Promise<string> {
      const estimatedTokens = Math.ceil(prompt.length / 4);
      sharedRateLimiter?.check(providerName, estimatedTokens);

      const start = Date.now();
      try {
        const response = await fetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false }),
        });

        if (!response.ok) {
          throw new Error(`Ollama ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as { response: string };
        const result = data.response.trim();

        sharedRateLimiter?.record(providerName);
        logAICall({
          provider: providerName,
          taskType: "chat",
          prompt,
          response: result,
          durationMs: Date.now() - start,
          success: true,
        });
        return result;
      } catch (err) {
        logAICall({
          provider: providerName,
          taskType: "chat",
          prompt,
          response: "",
          durationMs: Date.now() - start,
          success: false,
          error: (err as Error).message,
        });
        throw err;
      }
    },

    async chatJSON<T>(prompt: string): Promise<T> {
      const raw = await this.chat(
        prompt + "\n\nRespond with valid JSON only. No markdown, no explanation.",
      );
      return extractJSON<T>(raw);
    },

    async healthCheck(): Promise<boolean> {
      // /api/tags는 모델 목록 조회 — LLM 호출 아님, 할당량 소비 0
      try {
        const response = await fetch(`${url}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return false;

        const data = (await response.json()) as {
          models: Array<{ name: string }>;
        };
        return data.models.some((m) => m.name.startsWith(model));
      } catch {
        return false;
      }
    },
  };
}
