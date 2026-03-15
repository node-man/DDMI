/**
 * ddmi audit — 감사 로그 CLI
 *
 * 사용법:
 *   ddmi audit                           # 최근 20건
 *   ddmi audit --last 50                 # 최근 50건
 *   ddmi audit --file specs/cache.md     # 특정 파일 이력
 *   ddmi audit --type conflict_detected  # 이벤트 유형 필터
 *   ddmi audit --verify                  # 해시 체인 무결성 검증
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { createAuditTrail } from "../core/audit.js";

export async function runAudit(
  projectRoot: string,
  options: {
    last?: string;
    file?: string;
    type?: string;
    verify?: boolean;
  } = {},
): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  const trail = createAuditTrail(dbPath);

  // --verify: 해시 체인 검증
  if (options.verify) {
    const result = trail.verifyChain();
    if (result.valid) {
      console.log(`Chain valid (${result.checkedCount} events verified)`);
    } else {
      console.error(`Chain BROKEN at event: ${result.brokenAt}`);
      console.error(`Checked ${result.checkedCount} events before failure`);
      process.exit(1);
    }
    return;
  }

  // 이벤트 조회
  const events = trail.getEvents({
    targetFile: options.file,
    eventType: options.type as any,
    limit: options.last ? parseInt(options.last, 10) : 20,
  });

  if (events.length === 0) {
    console.log("No audit events found.");
    return;
  }

  console.log(`Audit log (${events.length} events):\n`);

  for (const e of events) {
    const file = e.targetFile ? ` → ${e.targetFile}` : "";
    const rationale = e.rationale ? ` | "${e.rationale}"` : "";
    console.log(
      `  [${e.timestamp.slice(0, 19)}] ${e.eventType.padEnd(20)} by ${e.actor}${file}${rationale}`,
    );
  }
}
