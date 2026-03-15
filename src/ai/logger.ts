/**
 * AI Logger — LLM 호출 로깅
 *
 * 모든 AI provider 호출을 파일에 기록한다.
 * 위치: .ddmi/ai.log (append-only, 사람이 읽을 수 있는 형식)
 *
 * 확인: cat .ddmi/ai.log 또는 ddmi status --ai-log
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
  promptLength: number;
  responseLength: number;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  if (!logPath) return;

  const ts = new Date().toISOString();
  const status = entry.success ? "OK" : `ERR: ${entry.error}`;
  const line = `[${ts}] ${entry.provider} | ${entry.taskType} | prompt=${entry.promptLength}ch → response=${entry.responseLength}ch | ${entry.durationMs}ms | ${status}\n`;

  try {
    appendFileSync(logPath, line, "utf-8");
  } catch {
    // 로깅 실패는 무시 — 메인 플로우를 방해하면 안 됨
  }
}

export function getLogPath(): string | null {
  return logPath;
}
