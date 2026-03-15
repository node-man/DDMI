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
  .action(() => {
    runInit(process.cwd());
  });

program
  .command("index")
  .description("Index all MD files in the project")
  .option("--incremental", "Only re-index changed files")
  .action(async (options) => {
    await runIndex(process.cwd(), { incremental: options.incremental });
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
  .action(async (_options) => {
    console.log("ddmi serve — not yet implemented (Week 3)");
  });

program.parse();
