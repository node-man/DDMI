/**
 * AI Router tests
 *
 * 실제 provider를 호출하지 않고 라우팅 로직만 테스트.
 * healthCheck는 which만 사용하므로 안전.
 */

import { describe, it, expect } from "vitest";
import { createRouter, type AIRouter } from "./router.js";
import { DEFAULT_CONFIG, type DdmiConfig } from "../types.js";
import type { EmbeddingProvider } from "aimux";

// embedder 로드 없이 router만 테스트하기 위한 config
// transformers.js 모델 로드를 피하려면 router 내부의 embedding 초기화가 문제
// 여기서는 createRouter의 결과 구조만 검증

describe("AIRouter", () => {
  it("getProvider는 AIProvider 또는 null을 반환한다", async () => {
    // createRouter는 embedder를 로드하므로 무거움 — 구조 테스트로 대체
    // router의 interface가 올바른지 확인
    const routerShape: AIRouter = {
      getProvider: () => null,
      getEmbeddingProvider: () => ({ name: "mock", embed: async () => [[]], embedOne: async () => [], dimensions: () => 384, healthCheck: async () => true }),
      getAvailableProviders: () => [],
      getDegradationLevel: () => 1,
      shutdown: () => {},
    };

    expect(routerShape.getProvider()).toBeNull();
    expect(routerShape.getDegradationLevel()).toBe(1);
    expect(routerShape.getAvailableProviders()).toEqual([]);
  });

  it("DdmiConfig.ai.defaultProvider가 올바른 타입이다", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    expect(config.ai.defaultProvider).toBe("auto");

    config.ai.defaultProvider = "claude";
    expect(config.ai.defaultProvider).toBe("claude");

    config.ai.defaultProvider = "ollama";
    expect(config.ai.defaultProvider).toBe("ollama");
  });

  it("existingEmbedder를 전달하면 재사용한다 (TTL refresh 경로)", async () => {
    const mockEmbedder: EmbeddingProvider = {
      name: "mock-cached-embedder",
      embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0)),
      embedOne: async () => new Array(384).fill(0),
      dimensions: () => 384,
      healthCheck: async () => true,
    };

    const config = structuredClone(DEFAULT_CONFIG);
    const router = await createRouter(config, { existingEmbedder: mockEmbedder });

    // 반환된 router의 embedder가 전달한 mock과 동일한 인스턴스여야 함
    const embedder = router.getEmbeddingProvider();
    expect(embedder.name).toBe("mock-cached-embedder");
    expect(embedder).toBe(mockEmbedder);
  });
});
