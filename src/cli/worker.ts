/**
 * ddmi worker — AI 태스크 큐 처리 워커
 *
 * SQLite 큐에서 태스크를 꺼내 LLM으로 처리한다.
 * 여러 worker를 동시에 띄울 수 있음 — 각자 다른 태스크를 가져감.
 *
 * 사용법:
 *   ddmi worker                    # config.toml의 default_provider 사용
 *   ddmi worker --provider claude  # claude CLI 사용
 *   ddmi worker --provider ollama  # ollama 사용
 *
 * 다중 worker:
 *   ddmi worker --provider claude &
 *   ddmi worker --provider ollama &
 *   ddmi worker --provider codex &
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { initDatabase } from "../storage/sqlite.js";
import { createWorker } from "../ai/queue.js";
import { initAILogger } from "../ai/logger.js";
import { createRouter } from "../ai/router.js";

export async function runWorker(
  projectRoot: string,
  options: { provider?: string } = {},
): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  initAILogger(ddmiDir);
  const config = loadConfig(projectRoot);

  if (options.provider) {
    config.ai.defaultProvider = options.provider;
  }

  const router = await createRouter(config);
  const aiProvider = router.getProvider();

  if (!aiProvider) {
    console.error("Error: No AI provider available. Worker requires Level 2.");
    console.error("Options: --provider claude | codex | gemini | ollama");
    process.exit(1);
  }

  const db = initDatabase(dbPath);
  const worker = createWorker(db, aiProvider);

  console.log(`ddmi worker started`);
  console.log(`  Provider:  ${aiProvider.name}`);
  console.log(`  Pending:   ${worker.pendingCount()} tasks`);
  console.log(`  Log:       ${ddmiDir}/ai.log`);
  console.log(`  Ctrl+C to stop\n`);

  worker.start();

  // 30초마다 상태
  const statusTimer = setInterval(() => {
    const pending = worker.pendingCount();
    if (pending > 0) {
      console.log(`[worker:${aiProvider.name}] ${pending} tasks pending`);
    }
  }, 30000);

  const shutdown = () => {
    console.log(`\n[worker:${aiProvider.name}] shutting down...`);
    worker.stop();
    clearInterval(statusTimer);
    router.shutdown();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
