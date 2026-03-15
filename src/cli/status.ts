/**
 * ddmi status — 프로젝트 건강도 CLI
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  initDatabase,
  getFileCount,
  getChunkCount,
  getRelationCount,
  getConflictCount,
  getPendingTaskCount,
} from "../storage/sqlite.js";
import { createAuditTrail } from "../core/audit.js";
import { loadConfig } from "../core/config.js";

export async function runStatus(projectRoot: string): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  const db = initDatabase(dbPath);
  const config = loadConfig(projectRoot);
  const trail = createAuditTrail(dbPath);
  const chain = trail.verifyChain();

  const files = getFileCount(db);
  const chunks = getChunkCount(db);
  const relations = getRelationCount(db);
  const conflicts = getConflictCount(db);
  const auditEvents = trail.getEvents({}).length;
  const pendingTasks = getPendingTaskCount(db);

  console.log("ddmi status");
  console.log(`  Files:       ${files} indexed`);
  console.log(`  Chunks:      ${chunks.toLocaleString()}`);
  console.log(`  Relations:   ${relations}`);
  console.log(`  Conflicts:   ${conflicts} open`);
  console.log(`  Audit:       ${auditEvents} events, chain ${chain.valid ? "valid" : "BROKEN"}`);
  console.log(`  Queue:       ${pendingTasks} pending tasks`);
  console.log(`  Provider:    ${config.ai.defaultProvider}`);
  console.log(`  Dashboard:   http://localhost:3000`);

  db.close();
}
