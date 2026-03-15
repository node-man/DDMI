/**
 * Ollama Provider — 로컬 LLM 서버
 *
 * Ollama HTTP API를 직접 호출. 외부 의존성 없음 (fetch만 사용).
 * 기본 URL: http://localhost:11434
 */

import type { AIProvider } from "../../types.js";
import { extractJSON } from "../utils.js";
import { logAICall } from "../logger.js";

export function createOllamaProvider(
  url: string = "http://localhost:11434",
  model: string = "llama3.2",
): AIProvider {
  return {
    name: `ollama:${model}`,

    async chat(prompt: string): Promise<string> {
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
        logAICall({
          provider: `ollama:${model}`,
          taskType: "chat",
          promptLength: prompt.length,
          responseLength: result.length,
          durationMs: Date.now() - start,
          success: true,
        });
        return result;
      } catch (err) {
        logAICall({
          provider: `ollama:${model}`,
          taskType: "chat",
          promptLength: prompt.length,
          responseLength: 0,
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
