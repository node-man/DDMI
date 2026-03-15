/**
 * ddmi serve — MCP Server + optional file watcher
 */

import { join } from "node:path";
import { startServer } from "../mcp/server.js";
import { startDashboard } from "../dashboard/server.js";
import { initDatabase } from "../storage/sqlite.js";
import { runIndex } from "./index-cmd.js";

export async function runServe(
  projectRoot: string,
  options: { watch?: boolean } = {},
): Promise<void> {
  if (options.watch) {
    await startWatcher(projectRoot);
  }

  // Dashboard (localhost:3000)
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const db = initDatabase(dbPath);
  startDashboard(db, dbPath);

  // MCP Server (stdio)
  await startServer(projectRoot);
}

async function startWatcher(projectRoot: string): Promise<void> {
  const { watch } = await import("chokidar");

  // chokidar v4: watch directory, filter .md files via ignored
  const watcher = watch(projectRoot, {
    ignored: (path: string) => {
      // Ignore non-.md files (but allow directories for traversal)
      const isDir = !path.includes(".");
      if (!isDir && !path.endsWith(".md")) return true;
      // Ignore standard dirs
      return /(node_modules|\.git|\.ddmi|dist|eval)/.test(path);
    },
    persistent: true,
    ignoreInitial: true,
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
