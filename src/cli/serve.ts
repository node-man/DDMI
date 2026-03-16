/**
 * ddmi serve — MCP Server + optional file watcher
 */

import { join } from "node:path";
import { startServer } from "../mcp/server.js";
import { startDashboard } from "../dashboard/server.js";
import { initDatabase } from "../storage/sqlite.js";
import { runIndex } from "./index-cmd.js";
import { loadConfig } from "../core/config.js";
import { createRouter } from "../ai/router.js";
import { initAILogger } from "../ai/logger.js";
import type { CuratorDeps } from "../core/curator.js";

export async function runServe(
  projectRoot: string,
  options: { watch?: boolean; dashboardOnly?: boolean; port?: number } = {},
): Promise<void> {
  if (options.watch) {
    await startWatcher(projectRoot);
  }

  // 초기화 확인
  const ddmiDir = join(projectRoot, ".ddmi");
  const { existsSync } = await import("node:fs");
  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  // Dashboard (localhost:3000)
  const dbPath = join(ddmiDir, "index.db");
  const db = initDatabase(dbPath);

  // Initialize AI router for dashboard AI features
  const config = loadConfig(projectRoot);
  initAILogger(ddmiDir);
  const router = await createRouter(config);
  const aiProvider = router.getProvider();

  // Curator deps for knowledge query
  const lancePath = join(ddmiDir, "vectors.lance");
  let curatorDeps: CuratorDeps | null = null;
  try {
    const { initVectorStore } = await import("../storage/lance.js");
    const lance = await initVectorStore(lancePath);
    curatorDeps = {
      embedder: router.getEmbeddingProvider(),
      lance,
      dbPath,
      weights: config.curator.weights,
    };
  } catch {
    // LanceDB not available — knowledge query will be disabled
    console.error("[ddmi] Warning: LanceDB not available, knowledge_query disabled");
  }

  const providers = router.getAvailableProviders();
  const level = router.getDegradationLevel();
  console.error(`[ddmi] Level ${level} | Providers: ${providers.length > 0 ? providers.join(", ") : "none"}`);

  // TTL 캐시: embedder는 영구 캐시 (무거움), router는 60초마다 갱신 (provider 감지)
  const cachedEmbedder = router.getEmbeddingProvider();
  const cachedWeights = config.curator.weights;
  let cachedRouter = router;
  let lastRouterRefresh = Date.now();
  const ROUTER_TTL_MS = 60_000;

  async function getFreshRouter() {
    if (Date.now() - lastRouterRefresh > ROUTER_TTL_MS) {
      try {
        cachedRouter = await createRouter(loadConfig(projectRoot));
        lastRouterRefresh = Date.now();
      } catch { /* keep existing router */ }
    }
    return cachedRouter;
  }

  startDashboard(db, dbPath, options.port ?? 3000, {
    getCuratorDeps: async () => {
      try {
        const { initVectorStore } = await import("../storage/lance.js");
        const lance = await initVectorStore(join(ddmiDir, "vectors.lance"));
        return { embedder: cachedEmbedder, lance, dbPath, weights: cachedWeights };
      } catch { return null; }
    },
    getAIProvider: async () => {
      const rtr = await getFreshRouter();
      return rtr.getProvider();
    },
    projectRoot,
  });

  if (options.dashboardOnly) {
    // Dashboard만 — MCP 없이 브라우저에서 확인 가능
    console.log("ddmi dashboard running. Press Ctrl+C to stop.");
    process.on("SIGINT", () => { router.shutdown(); db.close(); process.exit(0); });
    process.on("SIGTERM", () => { router.shutdown(); db.close(); process.exit(0); });
    // 프로세스 유지
    await new Promise(() => {});
  } else {
    // MCP Server (stdio) + Dashboard
    await startServer(projectRoot);
  }
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
