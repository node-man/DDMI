/**
 * knowledge_query MCP Tool
 *
 * 자연어 질문 → 벡터 검색 → LLM 요약/분석 → 구조화된 답변 반환.
 * context_assemble과의 차이: LLM 1회 호출, 자연어 답변 반환.
 * Level 2 필수 (LLM provider 없으면 에러).
 */

import type { CuratorDeps } from "../../core/curator.js";
import { createCurator } from "../../core/curator.js";
import type { AIProvider } from "../../types.js";

export const TOOL_NAME = "knowledge_query";

export const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Ask a natural language question about the project documents. " +
    "Returns a synthesized answer with source references. Requires LLM provider (Level 2).",
  inputSchema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description: "Natural language question about the project",
      },
      depth: {
        type: "string",
        enum: ["shallow", "deep"],
        description: "shallow: direct answer. deep: with provenance chain (default: shallow)",
      },
    },
    required: ["question"],
  },
};

export async function handleKnowledgeQuery(
  deps: CuratorDeps,
  aiProvider: AIProvider | null,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const question = args.question as string;

  if (!aiProvider) {
    return {
      content: [
        {
          type: "text",
          text: "Error: knowledge_query requires an LLM provider (Level 2). " +
            "No AI provider is available. Install claude CLI, Ollama, or configure an API key. " +
            "Use context_assemble instead for LLM-free context retrieval.",
        },
      ],
    };
  }

  // 1. Retrieve relevant context (reuse curator)
  const curator = await createCurator(deps);
  const bundle = await curator.assembleContext({
    intent: question,
    taskType: "research",
    maxTokens: 4000, // Leave room for LLM prompt
  });

  if (bundle.blocks.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No relevant documents found for: "${question}"\n\n` +
            "Try rephrasing your question or ensure the project is indexed (`ddmi index`).",
        },
      ],
    };
  }

  // 2. Build prompt with retrieved context
  const contextText = bundle.blocks
    .map(
      (b) =>
        `[Source: ${b.source}]\n${b.content}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Based on the following project documents, answer this question concisely and accurately.

Question: ${question}

Documents:
${contextText}

Instructions:
- Answer based ONLY on the provided documents
- If the documents don't contain enough information, say so
- Cite sources using [Source: ...] format
- Keep the answer concise but complete
- Use the same language as the question`;

  // 3. LLM call
  try {
    const answer = await aiProvider.chat(prompt);

    const sources = bundle.blocks.map((b) => b.source);

    const parts = [
      `## Answer`,
      "",
      answer,
      "",
      `## Sources (${sources.length})`,
      ...sources.map((s) => `- ${s}`),
      "",
      `_Level 2 | Provider: ${aiProvider.name} | Context: ${bundle.totalTokens} tokens_`,
    ];

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error calling LLM provider (${aiProvider.name}): ${(err as Error).message}\n\n` +
            "Falling back to raw context. Use context_assemble for reliable retrieval.",
        },
      ],
    };
  }
}
