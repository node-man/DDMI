/**
 * AI Logger — LLM 호출 로깅 (JSONL)
 *
 * 모든 AI provider 호출을 지정된 디렉토리의 ai.log에 기록한다.
 * 한 줄 = JSON 한 객체 (prompt, response 전문 포함).
 *
 * 확인 방법:
 *   cat <dir>/ai.log                              # 원본
 *   jq . <dir>/ai.log                             # 예쁘게
 *   jq 'select(.success==false)' <dir>/ai.log     # 실패만
 *   jq '{provider,durationMs,prompt}' <dir>/ai.log # 요약
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AILogEntry } from "./types.js";

let logPath: string | null = null;

export function initAILogger(logDir: string): void {
  logPath = join(logDir, "ai.log");
  if (!existsSync(dirname(logPath))) {
    mkdirSync(dirname(logPath), { recursive: true });
  }
}

export function logAICall(entry: AILogEntry): void {
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
