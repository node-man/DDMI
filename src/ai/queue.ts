/**
 * AITaskQueue — SQLite 영속 큐 + Worker Loop
 *
 * Producer (ddmi index): 유사도 쌍 발견 → enqueueTask()
 * Worker (ddmi serve): pollAndProcess() 루프 → 배치로 묶어서 LLM 호출
 *
 * 큐가 SQLite에 있으므로:
 * - 프로세스 재시작해도 작업 유실 안 됨
 * - ddmi index는 LLM 응답을 기다리지 않음 (비동기)
 * - 배치 크기 조절로 LLM 호출 최소화
 */

import type Database from "better-sqlite3";
import type { AIProvider } from "../types.js";
import {
  dequeueTasks,
  completeTask,
  failTask,
  getPendingTaskCount,
  type QueuedTask,
} from "../storage/sqlite.js";
import { insertConflict } from "../storage/sqlite.js";
import type { Conflict } from "../types.js";
import { randomUUID } from "node:crypto";
import { logAICall } from "./logger.js";

export interface WorkerConfig {
  pollIntervalMs: number;   // 큐 폴링 간격 (기본 5초)
  batchSize: number;        // 한 번에 꺼낼 태스크 수 (기본 10)
}

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  pollIntervalMs: 5000,
  batchSize: 10,
};

export interface AIWorker {
  /** Worker loop 시작 */
  start(): void;
  /** Worker loop 중지 */
  stop(): void;
  /** 현재 대기 중인 태스크 수 */
  pendingCount(): number;
  /** 즉시 큐 처리 (테스트용) */
  processOnce(): Promise<number>;
}

export function createWorker(
  db: Database.Database,
  aiProvider: AIProvider | null,
  config: Partial<WorkerConfig> = {},
): AIWorker {
  const cfg = { ...DEFAULT_WORKER_CONFIG, ...config };
  let timer: ReturnType<typeof setInterval> | null = null;
  let processing = false;

  async function processOnce(): Promise<number> {
    if (processing || !aiProvider) return 0;
    processing = true;

    try {
      const tasks = dequeueTasks(db, cfg.batchSize);
      if (tasks.length === 0) return 0;

      // 태스크 타입별로 그룹화
      const grouped = new Map<string, QueuedTask[]>();
      for (const t of tasks) {
        const list = grouped.get(t.taskType) ?? [];
        list.push(t);
        grouped.set(t.taskType, list);
      }

      let processed = 0;

      for (const [taskType, batch] of grouped) {
        if (taskType === "conflict_detection") {
          processed += await processConflictBatch(db, aiProvider, batch);
        } else {
          // 알 수 없는 태스크 타입 → 실패 처리
          for (const t of batch) {
            failTask(db, t.id, `Unknown task type: ${taskType}`);
          }
          processed += batch.length;
        }
      }

      return processed;
    } finally {
      processing = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void processOnce();
      }, cfg.pollIntervalMs);
      // 시작 시 즉시 1회 실행
      void processOnce();
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

    processOnce,
  };
}

// ─── Task Processors ────────────────────────────────────

async function processConflictBatch(
  db: Database.Database,
  aiProvider: AIProvider,
  tasks: QueuedTask[],
): Promise<number> {
  // 모든 태스크의 pairs를 합쳐서 하나의 프롬프트로
  const allPairs: Array<{
    taskId: string;
    pairIndex: number;
    aId: string;
    aContent: string;
    bId: string;
    bContent: string;
  }> = [];

  for (const task of tasks) {
    const pairs = (task.payload.pairs ?? []) as Array<{
      aId: string; aContent: string; bId: string; bContent: string;
    }>;
    for (let i = 0; i < pairs.length; i++) {
      allPairs.push({ taskId: task.id, pairIndex: i, ...pairs[i] });
    }
  }

  if (allPairs.length === 0) {
    for (const t of tasks) completeTask(db, t.id, { conflicts: 0 });
    return tasks.length;
  }

  // 프롬프트 생성
  const pairTexts = allPairs.map((p, i) =>
    `--- Pair ${i} ---\nA (${p.aId}): ${p.aContent.slice(0, 400)}\nB (${p.bId}): ${p.bContent.slice(0, 400)}`
  ).join("\n\n");

  const prompt = `Analyze document chunk pairs for contradictions.
A conflict = two chunks making incompatible claims about the same topic.
High-precision preferred — only flag genuine conflicts.

${pairTexts}

Respond with JSON array:
[{"pair_index": <number>, "is_conflict": <boolean>, "severity": "low"|"medium"|"high", "description": "<string>"}]`;

  const start = Date.now();
  try {
    const results = await aiProvider.chatJSON<Array<{
      pair_index: number;
      is_conflict: boolean;
      severity: string;
      description: string;
    }>>(prompt);

    logAICall({
      provider: aiProvider.name,
      taskType: "conflict_detection_batch",
      prompt,
      response: JSON.stringify(results),
      durationMs: Date.now() - start,
      success: true,
    });

    // 충돌 저장
    let conflictCount = 0;
    for (const r of results) {
      if (!r.is_conflict || r.pair_index < 0 || r.pair_index >= allPairs.length) continue;
      const pair = allPairs[r.pair_index];

      const conflict: Conflict = {
        id: randomUUID().slice(0, 16),
        chunkAId: pair.aId,
        chunkBId: pair.bId,
        severity: (["low", "medium", "high"].includes(r.severity) ? r.severity : "medium") as Conflict["severity"],
        description: r.description || "Conflict detected",
        status: "open",
        detectedAt: new Date().toISOString(),
      };
      insertConflict(db, conflict);
      conflictCount++;
    }

    // 태스크 완료
    for (const t of tasks) {
      completeTask(db, t.id, { conflicts: conflictCount, pairs: allPairs.length });
    }

    if (conflictCount > 0) {
      console.error(`[ddmi worker] ${conflictCount} conflicts detected from ${allPairs.length} pairs`);
    }

    return tasks.length;
  } catch (err) {
    logAICall({
      provider: aiProvider.name,
      taskType: "conflict_detection_batch",
      prompt,
      response: "",
      durationMs: Date.now() - start,
      success: false,
      error: (err as Error).message,
    });

    for (const t of tasks) {
      failTask(db, t.id, (err as Error).message);
    }
    return tasks.length;
  }
}
