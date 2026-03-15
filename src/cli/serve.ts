/**
 * ddmi serve — MCP Server + optional file watcher
 */

import { join } from "node:path";
import { startServer } from "../mcp/server.js";
import { runIndex } from "./index-cmd.js";

export async function runServe(
  projectRoot: string,
  options: { watch?: boolean } = {},
): Promise<void> {
  if (options.watch) {
    await startWatcher(projectRoot);
  }

  await startServer(projectRoot);
}

async function startWatcher(projectRoot: string): Promise<void> {
  const { watch } = await import("chokidar");

  const watcher = watch(join(projectRoot, "**/*.md"), {
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.ddmi/**",
      "**/dist/**",
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReindex = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.error("[ddmi] File change detected, re-indexing...");
      try {
        await runIndex(projectRoot, { incremental: true });
        console.error("[ddmi] Re-index complete.");
      } catch (err) {
        console.error(`[ddmi] Re-index error: ${(err as Error).message}`);
      }
    }, 2000);
  };

  watcher
    .on("add", scheduleReindex)
    .on("change", scheduleReindex)
    .on("unlink", scheduleReindex);

  console.error("[ddmi] Watching for file changes...");
}
