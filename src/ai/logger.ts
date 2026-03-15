/**
 * AI Logger — LLM 호출 로깅 (JSONL)
 *
 * 모든 AI provider 호출을 .ddmi/ai.log에 기록한다.
 * 한 줄 = JSON 한 객체 (prompt, response 전문 포함).
 *
 * 확인 방법:
 *   cat .ddmi/ai.log                              # 원본
 *   jq . .ddmi/ai.log                             # 예쁘게
 *   jq 'select(.success==false)' .ddmi/ai.log     # 실패만
 *   jq '{provider,durationMs,prompt}' .ddmi/ai.log # 요약
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

let logPath: string | null = null;

export function initAILogger(ddmiDir: string): void {
  logPath = join(ddmiDir, "ai.log");
  if (!existsSync(dirname(logPath))) {
    mkdirSync(dirname(logPath), { recursive: true });
  }
}

export function logAICall(entry: {
  provider: string;
  taskType: string;
  prompt: string;
  response: string;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  if (!logPath) return;

  const record = {
    ts: new Date().toISOString(),
    provider: entry.provider,
    taskType: entry.taskType,
    prompt: entry.prompt,
    response: entry.response,
    promptChars: entry.prompt.length,
    responseChars: entry.response.length,
    durationMs: entry.durationMs,
    success: entry.success,
    ...(entry.error ? { error: entry.error } : {}),
  };

  try {
    appendFileSync(logPath, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    // 로깅 실패는 무시 — 메인 플로우를 방해하면 안 됨
  }
}

export function getLogPath(): string | null {
  return logPath;
}
