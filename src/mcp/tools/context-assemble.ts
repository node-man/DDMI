/**
 * context_assemble MCP Tool
 *
 * Agent가 작업 시작 시 호출하는 핵심 도구.
 * 질의 → Context Curator → ContextBundle 반환.
 */

import type { CuratorDeps } from "../../core/curator.js";
import { createCurator } from "../../core/curator.js";
import type { ContextRequest } from "../../types.js";

export const TOOL_NAME = "context_assemble";

export const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Assemble optimal context from project documents for the given task. " +
    "Returns curated document blocks ranked by relevance, with coverage score and feedback token.",
  inputSchema: {
    type: "object" as const,
    properties: {
      intent: {
        type: "string",
        description: "What you want to accomplish (e.g., 'implement cache module')",
      },
      task_type: {
        type: "string",
        enum: ["implementation", "review", "research", "planning"],
        description: "Type of task to optimize context for",
      },
      max_tokens: {
        type: "number",
        description: "Maximum token budget for context (default: 8000)",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "File paths or patterns to exclude",
      },
    },
    required: ["intent", "task_type"],
  },
};

export async function handleContextAssemble(
  deps: CuratorDeps,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const curator = await createCurator(deps);

  const req: ContextRequest = {
    intent: args.intent as string,
    taskType: args.task_type as ContextRequest["taskType"],
    maxTokens: (args.max_tokens as number) ?? 8000,
    exclude: args.exclude as string[] | undefined,
  };

  const bundle = await curator.assembleContext(req);

  // Format output for MCP
  const parts: string[] = [
    `## Context for: ${req.intent}`,
    `Coverage: ${bundle.coverageScore.toFixed(2)} | Tokens: ${bundle.totalTokens}/${req.maxTokens}`,
    bundle.metaSummary,
    "",
  ];

  for (const block of bundle.blocks) {
    parts.push(
      `### ${block.source} (relevance: ${block.relevance.toFixed(2)})`,
      block.content,
      "",
    );
  }

  parts.push(`\n_Feedback token: ${bundle.feedbackToken}_`);

  return {
    content: [{ type: "text", text: parts.join("\n") }],
  };
}
