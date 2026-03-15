/**
 * AI Worker — MQ 패턴으로 태스크 순차 처리
 *
 * 유휴 상태일 때 큐에서 1개씩 꺼내서 처리.
 * 배치 병합 없음 — 각 태스크가 독립적으로 처리되어
 * 실패 격리 + 프롬프트 집중도가 높아짐.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AIProvider, Conflict } from "../types.js";
import {
  dequeueTasks,
  completeTask,
  failTask,
  getPendingTaskCount,
  reclaimStaleTasks,
  type QueuedTask,
} from "../storage/sqlite.js";
import { insertConflict } from "../storage/sqlite.js";
import { logAICall } from "./logger.js";

export interface WorkerConfig {
  pollIntervalMs: number; // 큐 비었을 때 대기 (기본 5초)
  workerId?: string;       // worker 식별자 (미지정 시 자동 생성)
}

export interface AIWorker {
  start(): void;
  stop(): void;
  pendingCount(): number;
  /** 큐에서 1개 꺼내서 처리. 테스트용. 처리했으면 true. */
  processOne(): Promise<boolean>;
}

export function createWorker(
  db: Database.Database,
  aiProvider: AIProvider | null,
  config: Partial<WorkerConfig> = {},
): AIWorker {
  const pollMs = config.pollIntervalMs ?? 5000;
  const workerId = config.workerId ?? `${aiProvider?.name ?? "unknown"}-${randomUUID().slice(0, 6)}`;
  let timer: ReturnType<typeof setInterval> | null = null;
  let processing = false;

  async function processOne(): Promise<boolean> {
    if (processing || !aiProvider) return false;
    processing = true;

    try {
      const tasks = dequeueTasks(db, 1, workerId); // 1개, worker_id 스탬프
      if (tasks.length === 0) return false;

      const task = tasks[0];

      switch (task.taskType) {
        case "conflict_detection":
          await processConflictTask(db, aiProvider, task);
          break;
        default:
          failTask(db, task.id, `Unknown task type: ${task.taskType}`);
      }

      return true;
    } finally {
      processing = false;
    }
  }

  return {
    start(): void {
      if (timer) return;

      // 유휴 시 폴링, 태스크 있으면 연속 처리
      const poll = async () => {
        const processed = await processOne();
        if (processed) {
          // 처리했으면 즉시 다음 확인 (쉬지 않고)
          setImmediate(poll);
        }
        // else: 큐 비었으면 interval이 다음 폴링 담당
      };

      // 시작 시 stale 태스크 복구 (이전 worker 크래시 대비)
      const reclaimed = reclaimStaleTasks(db);
      if (reclaimed > 0) {
        console.error(`[ddmi worker] reclaimed ${reclaimed} stale tasks`);
      }

      timer = setInterval(poll, pollMs);
      void poll();
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    pendingCount(): number {
      return getPendingTaskCount(db);
    },

    processOne,
  };
}

// ─── Task Processor ─────────────────────────────────────

async function processConflictTask(
  db: Database.Database,
  aiProvider: AIProvider,
  task: QueuedTask,
): Promise<void> {
  // 1 태스크 = 1 쌍
  const pair = task.payload as { aId: string; aContent: string; bId: string; bContent: string };

  if (!pair.aId || !pair.bId) {
    failTask(db, task.id, "Invalid payload: missing aId or bId");
    return;
  }

  const prompt = `Compare these two document chunks. Do they contradict each other?

Chunk A (${pair.aId}):
${pair.aContent.slice(0, 600)}

Chunk B (${pair.bId}):
${pair.bContent.slice(0, 600)}

Respond with JSON:
{"is_conflict": true/false, "severity": "low"/"medium"/"high", "description": "one sentence"}

Only flag TRUE contradictions. High-precision preferred.`;

  const start = Date.now();
  try {
    const result = await aiProvider.chatJSON<{
      is_conflict: boolean;
      severity: string;
      description: string;
    }>(prompt);

    logAICall({
      provider: aiProvider.name,
      taskType: "conflict_detection",
      prompt,
      response: JSON.stringify(result),
      durationMs: Date.now() - start,
      success: true,
    });

    if (result.is_conflict) {
      const conflict: Conflict = {
        id: randomUUID().slice(0, 16),
        chunkAId: pair.aId,
        chunkBId: pair.bId,
        severity: (["low", "medium", "high"].includes(result.severity)
          ? result.severity : "medium") as Conflict["severity"],
        description: result.description || "Conflict detected",
        status: "open",
        detectedAt: new Date().toISOString(),
      };
      insertConflict(db, conflict);
      console.error(`[ddmi worker] conflict: ${pair.aId} vs ${pair.bId} (${result.severity})`);
    }

    completeTask(db, task.id, { is_conflict: result.is_conflict });
  } catch (err) {
    logAICall({
      provider: aiProvider.name,
      taskType: "conflict_detection",
      prompt,
      response: "",
      durationMs: Date.now() - start,
      success: false,
      error: (err as Error).message,
    });
    // 실패한 태스크는 failed로 마킹 — 다음 worker 시작 시 reclaim 안 됨 (의도적)
    failTask(db, task.id, (err as Error).message);
  }
}
