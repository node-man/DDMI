/**
 * context_feedback MCP Tool
 *
 * Agent가 작업 완료 후 호출 (선택적).
 * 어떤 블록이 유용했는지 피드백 수집 → feedback_log 저장.
 */

import type Database from "better-sqlite3";
import { recordFeedback } from "../../core/feedback.js";
import type { FeedbackInput } from "../../types.js";

export const TOOL_NAME = "context_feedback";

export const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Provide feedback on context quality after completing a task. " +
    "Helps ddmi learn which documents are useful for which tasks.",
  inputSchema: {
    type: "object" as const,
    properties: {
      feedback_token: {
        type: "string",
        description: "Token from context_assemble response",
      },
      outcome: {
        type: "string",
        enum: ["helpful", "partial", "irrelevant", "missing"],
        description: "How useful was the provided context",
      },
      blocks_used: {
        type: "array",
        items: { type: "string" },
        description: "Source paths of blocks that were actually used",
      },
      blocks_irrelevant: {
        type: "array",
        items: { type: "string" },
        description: "Source paths of blocks that were not useful",
      },
      missing_context: {
        type: "string",
        description: "Description of information that was missing",
      },
    },
    required: ["feedback_token", "outcome"],
  },
};

export function handleContextFeedback(
  db: Database.Database,
  args: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }> } {
  const input: FeedbackInput = {
    feedbackToken: args.feedback_token as string,
    outcome: args.outcome as FeedbackInput["outcome"],
    blocksUsed: args.blocks_used as string[] | undefined,
    blocksIrrelevant: args.blocks_irrelevant as string[] | undefined,
    missingContext: args.missing_context as string | undefined,
  };

  const record = recordFeedback(db, input, {
    intent: "", // Not available from feedback alone
    taskType: "",
    blocksServed: [],
  });

  return {
    content: [
      {
        type: "text",
        text: `Feedback recorded. ID: ${record.id}`,
      },
    ],
  };
}
