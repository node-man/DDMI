/**
 * Context Curator — ddmi의 심장
 *
 * Agent 질의를 받아 최적의 컨텍스트를 조립한다.
 * 파이프라인: 질의 임베딩 → 벡터 검색 → 스코어링 → 예산 패킹 → 조립
 *
 * 핵심: 이 모듈에 LLM 호출은 0회. 전부 전통 알고리즘.
 */

import type { ContextRequest, ContextBundle } from "../types.js";

export async function assembleContext(
  req: ContextRequest,
): Promise<ContextBundle> {
  // TODO: implement scoring + packing + assembly
  throw new Error("Not implemented");
}
