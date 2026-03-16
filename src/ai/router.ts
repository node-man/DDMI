/**
 * AI Router — ddmi-specific wrapper around aimux router
 *
 * aimux의 createRouter를 래핑하여 DdmiConfig → RouterConfig 변환.
 * AIRouter 인터페이스도 aimux에서 re-export.
 */

import type { DdmiConfig, AITaskType } from "../types.js";
import {
  createRouter as createAimuxRouter,
  type AIRouter as AimuxRouter,
  type RouterConfig,
} from "aimux";

// Re-export AIRouter — 기존 코드 호환
export type AIRouter = AimuxRouter;

export async function createRouter(config: DdmiConfig): Promise<AIRouter> {
  const routerConfig: RouterConfig = {
    defaultProvider: config.ai.defaultProvider,
    ollamaUrl: config.ai.ollamaUrl,
    ollamaModel: config.ai.ollamaModel,
    embeddingModel: config.embedding.model,
  };

  return createAimuxRouter(routerConfig);
}
