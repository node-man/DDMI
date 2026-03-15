/**
 * AITaskQueue — 배치 실행, flush 로직, 동시성 제한
 *
 * LLM 호출을 개별로 하면 비효율적.
 * 태스크를 모아서 배치로 보내고, immediate 우선순위는 즉시 실행.
 */

import { randomUUID } from "node:crypto";
import type { AIProvider, AITask, AITaskType } from "../types.js";
import type { AIRouter } from "./router.js";

export interface AITaskQueue {
  enqueue<T>(
    task: Omit<AITask, "id">,
  ): Promise<T>;
  flush(type?: AITaskType): Promise<void>;
  pending(): number;
  shutdown(): void;
}

export interface AITaskQueueConfig {
  batchSize: number;       // default 10
  flushIntervalMs: number; // default 3000
  concurrentLimit: number; // default 3
}

const DEFAULT_QUEUE_CONFIG: AITaskQueueConfig = {
  batchSize: 10,
  flushIntervalMs: 3000,
  concurrentLimit: 3,
};

interface PendingTask<T = unknown> {
  task: AITask;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function createTaskQueue(
  router: AIRouter,
  config: Partial<AITaskQueueConfig> = {},
): AITaskQueue {
  const cfg = { ...DEFAULT_QUEUE_CONFIG, ...config };
  const pending: PendingTask[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let activeCount = 0;

  // Auto-flush timer
  flushTimer = setInterval(() => {
    if (pending.length > 0) {
      void flushBatch();
    }
  }, cfg.flushIntervalMs);

  async function flushBatch(typeFilter?: AITaskType): Promise<void> {
    // Get tasks to process
    const toProcess: PendingTask[] = [];
    const remaining: PendingTask[] = [];

    for (const p of pending) {
      if (typeFilter && p.task.type !== typeFilter) {
        remaining.push(p);
      } else if (toProcess.length < cfg.batchSize) {
        toProcess.push(p);
      } else {
        remaining.push(p);
      }
    }

    pending.length = 0;
    pending.push(...remaining);

    if (toProcess.length === 0) return;

    // Wait for concurrency slot
    while (activeCount >= cfg.concurrentLimit) {
      await new Promise((r) => setTimeout(r, 100));
    }

    activeCount++;

    try {
      const provider = router.getProvider(toProcess[0].task.type);
      if (!provider) {
        for (const p of toProcess) {
          p.reject(new Error("No AI provider available (Level 1 — LLM features disabled)"));
        }
        return;
      }

      // Execute individually for now (batch prompt merging is future optimization)
      for (const p of toProcess) {
        try {
          const result = await provider.chatJSON(p.task.prompt);
          p.resolve(result);
        } catch (err) {
          p.reject(
            err instanceof Error
              ? err
              : new Error(String(err)),
          );
        }
      }
    } finally {
      activeCount--;
    }
  }

  return {
    async enqueue<T>(taskInput: Omit<AITask, "id">): Promise<T> {
      const task: AITask = { ...taskInput, id: randomUUID() };

      // Immediate tasks bypass the queue
      if (task.priority === "immediate") {
        const provider = router.getProvider(task.type);
        if (!provider) {
          throw new Error("No AI provider available (Level 1 — LLM features disabled)");
        }
        return provider.chatJSON<T>(task.prompt);
      }

      // Batch tasks go to the queue
      return new Promise<T>((resolve, reject) => {
        pending.push({
          task,
          resolve: resolve as (v: unknown) => void,
          reject,
        });

        // Auto-flush when batch is full
        if (pending.length >= cfg.batchSize) {
          void flushBatch();
        }
      });
    },

    async flush(type?: AITaskType): Promise<void> {
      await flushBatch(type);
    },

    pending(): number {
      return pending.length;
    },

    shutdown(): void {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      // Reject remaining tasks
      for (const p of pending) {
        p.reject(new Error("Queue shutdown"));
      }
      pending.length = 0;
    },
  };
}
