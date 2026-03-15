#!/usr/bin/env node
/**
 * ddmi CLI — Document-Driven Memory Infrastructure
 *
 * Drift monitor & integrity layer for AI agents.
 */

import { Command } from "commander";
import { runInit } from "./init.js";
import { runIndex } from "./index-cmd.js";
import { runQuery } from "./query.js";
import { runServe } from "./serve.js";
import { runEval } from "./eval.js";
import { runWorker } from "./worker.js";

const program = new Command();

program
  .name("ddmi")
  .description(
    "Document-Driven Memory Infrastructure — drift monitor & integrity layer for AI agents",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize ddmi in the current project")
  .action(async () => {
    await runInit(process.cwd());
  });

program
  .command("index")
  .description("Index all MD files in the project")
  .option("--incremental", "Only re-index changed files")
  .option("--provider <name>", "AI provider for conflict detection: claude | codex | gemini | ollama")
  .action(async (options) => {
    await runIndex(process.cwd(), { incremental: options.incremental, provider: options.provider });
  });

program
  .command("query <question>")
  .description("Query the project knowledge base")
  .option("--task-type <type>", "Task type: implementation|review|research|planning", "research")
  .option("--max-tokens <n>", "Token budget", "8000")
  .option("--debug", "Show scoring details")
  .action(async (question, options) => {
    await runQuery(process.cwd(), question, options);
  });

program
  .command("serve")
  .description("Start MCP server")
  .option("--watch", "Watch for file changes and auto-reindex")
  .action(async (options) => {
    await runServe(process.cwd(), { watch: options.watch });
  });

program
  .command("eval")
  .description("Evaluate context quality with questions.json")
  .option("--questions <path>", "Path to questions JSON file")
  .option("--question <n>", "Run single question (0-indexed)")
  .option("--sim <n>", "Override semantic_sim weight", parseFloat)
  .option("--kw <n>", "Override keyword_boost weight", parseFloat)
  .option("--taa <n>", "Override task_aware_authority weight", parseFloat)
  .option("--rec <n>", "Override recency weight", parseFloat)
  .action(async (options) => {
    const weightsOverride: Record<string, number> = {};
    if (options.sim !== undefined) weightsOverride.semanticSim = options.sim;
    if (options.kw !== undefined) weightsOverride.keywordBoost = options.kw;
    if (options.rec !== undefined) weightsOverride.recency = options.rec;
    if (options.taa !== undefined) weightsOverride.taskAwareAuthority = options.taa;

    await runEval(process.cwd(), {
      questionsPath: options.questions,
      question: options.question !== undefined ? parseInt(options.question, 10) : undefined,
      weightsOverride: Object.keys(weightsOverride).length > 0 ? weightsOverride : undefined,
    });
  });

program
  .command("worker")
  .description("Start AI task queue worker")
  .option("--provider <name>", "AI provider: claude | codex | gemini | ollama")
  .action(async (options) => {
    await runWorker(process.cwd(), { provider: options.provider });
  });

program.parse();
