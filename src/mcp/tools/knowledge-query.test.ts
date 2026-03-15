/**
 * knowledge_query MCP tool tests
 */

import { describe, it, expect } from "vitest";
import { handleKnowledgeQuery, TOOL_SCHEMA } from "./knowledge-query.js";
import type { CuratorDeps } from "../../core/curator.js";

describe("knowledge_query", () => {
  it("TOOL_SCHEMA가 올바른 구조를 가진다", () => {
    expect(TOOL_SCHEMA.name).toBe("knowledge_query");
    expect(TOOL_SCHEMA.inputSchema.required).toContain("question");
  });

  it("provider 없으면 에러 메시지 반환", async () => {
    // Level 0 deps — embedder/lance 없어도 provider null 체크가 먼저
    const result = await handleKnowledgeQuery(
      { embedder: null, lance: null, dbPath: "nonexistent.db" } as any,
      null,
      { question: "test?" },
    );

    expect(result.content[0].text).toContain("LLM provider");
    expect(result.content[0].text).toContain("context_assemble");
  });
});
