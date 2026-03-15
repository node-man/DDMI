/**
 * CLI Subprocess Provider — claude, codex, gemini, llm 등
 *
 * CLI-first 전략의 핵심: 사용자의 기존 CLI 구독을 활용하여 $0 비용.
 *
 * 안전장치 (gemini 할당량 폭주 사건 후 추가):
 * 1. healthCheck = which만 사용 (API 호출 0)
 * 2. RateLimiter로 분당/세션당 호출 수 제한
 * 3. 모든 호출을 ai.log에 JSONL로 기록
 * 4. stdin-only 프롬프트 전달 (중복 전송 방지)
 */

import { execFile } from "node:child_process";
import type { AIProvider } from "../../types.js";
import { extractJSON } from "../utils.js";
import { logAICall } from "../logger.js";
import type { RateLimiter } from "../rate-limiter.js";

interface CLIConfig {
  command: string;
  args: string[];
  name: string;
  timeoutMs?: number;
  /** 프롬프트 전달 방식:
   * "stdin" — stdin으로 전달 (claude, codex, llm)
   * "arg"   — args 마지막에 프롬프트 추가 (gemini -p "prompt")
   */
  promptMode: "stdin" | "arg";
}

const CLI_TOOLS: Record<string, CLIConfig> = {
  claude: {
    command: "claude",
    args: ["-p", "--output-format", "text"],
    name: "Claude CLI",
    timeoutMs: 60000,
    promptMode: "stdin",
  },
  codex: {
    command: "codex",
    args: ["exec", "-"],
    name: "Codex CLI",
    timeoutMs: 60000,
    promptMode: "stdin",
  },
  gemini: {
    command: "gemini",
    args: ["-p", "", "-m", "gemini-3-flash-preview"],
    name: "Gemini CLI",
    timeoutMs: 60000,
    promptMode: "stdin",
  },
  llm: {
    command: "llm",
    args: [],
    name: "llm CLI",
    timeoutMs: 60000,
    promptMode: "stdin",
  },
};

/** rate limiter는 외부에서 주입. 모든 provider가 공유. */
let sharedRateLimiter: RateLimiter | null = null;

export function setRateLimiter(limiter: RateLimiter): void {
  sharedRateLimiter = limiter;
}

export function createCLIProvider(toolName: string): AIProvider {
  const config = CLI_TOOLS[toolName];
  if (!config) {
    throw new Error(
      `Unknown CLI tool: ${toolName}. Available: ${Object.keys(CLI_TOOLS).join(", ")}`,
    );
  }

  const providerName = `cli:${toolName}`;

  return {
    name: providerName,

    async chat(prompt: string): Promise<string> {
      // Rate limit check
      const estimatedTokens = Math.ceil(prompt.length / 4);
      sharedRateLimiter?.check(providerName, estimatedTokens);

      const start = Date.now();
      try {
        const result = await runCLI(config, prompt);

        sharedRateLimiter?.record(providerName);
        logAICall({
          provider: providerName,
          taskType: "chat",
          prompt,
          response: result,
          durationMs: Date.now() - start,
          success: true,
        });
        return result;
      } catch (err) {
        logAICall({
          provider: providerName,
          taskType: "chat",
          prompt,
          response: "",
          durationMs: Date.now() - start,
          success: false,
          error: (err as Error).message,
        });
        throw err;
      }
    },

    async chatJSON<T>(prompt: string): Promise<T> {
      const fullPrompt = prompt + "\n\nRespond with valid JSON only.";

      // Rate limit check
      const estimatedTokens = Math.ceil(fullPrompt.length / 4);
      sharedRateLimiter?.check(providerName, estimatedTokens);

      const start = Date.now();
      try {
        const raw = await runCLI(config, fullPrompt);
        const parsed = extractJSON<T>(raw);

        sharedRateLimiter?.record(providerName);
        logAICall({
          provider: providerName,
          taskType: "chatJSON",
          prompt: fullPrompt,
          response: raw,
          durationMs: Date.now() - start,
          success: true,
        });
        return parsed;
      } catch (err) {
        logAICall({
          provider: providerName,
          taskType: "chatJSON",
          prompt: fullPrompt,
          response: "",
          durationMs: Date.now() - start,
          success: false,
          error: (err as Error).message,
        });
        throw err;
      }
    },

    async healthCheck(): Promise<boolean> {
      // API 호출 절대 안 함. 바이너리 존재 여부만 확인.
      try {
        await which(config.command);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Detect which CLI tools are available on this system.
 * which만 사용 — API 호출 0회.
 */
export async function detectCLITools(): Promise<string[]> {
  const available: string[] = [];

  for (const [name, config] of Object.entries(CLI_TOOLS)) {
    try {
      await which(config.command);
      available.push(name);
    } catch {
      // Not installed
    }
  }

  return available;
}

/** 현재 실행 중인 CLI 프로세스 추적 */
const activeProcesses = new Set<number>();

/** 활성 프로세스 수 조회 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}

function runCLI(
  config: CLIConfig,
  prompt: string,
  timeoutMs?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs ?? config.timeoutMs ?? 60000;

    // promptMode에 따라 args 구성
    const args = [...config.args];
    if (config.promptMode === "arg") {
      args.push(prompt);
    }

    const child = execFile(
      config.command,
      args,
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
        killSignal: "SIGKILL", // SIGTERM 대신 SIGKILL — 자식 프로세스까지 확실히 종료
      },
      (error, stdout, stderr) => {
        // 프로세스 추적에서 제거
        if (child.pid) activeProcesses.delete(child.pid);

        if (error) {
          reject(new Error(`${config.name} failed: ${error.message}\nstderr: ${stderr}`));
          return;
        }
        resolve(stdout.trim());
      },
    );

    // 프로세스 추적 등록
    if (child.pid) activeProcesses.add(child.pid);

    // stdin 모드: 프롬프트를 stdin으로 전달
    if (config.promptMode === "stdin" && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

/** ddmi 종료 시 남은 프로세스 정리 */
export function cleanupProcesses(): void {
  for (const pid of activeProcesses) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 이미 종료됨
    }
  }
  activeProcesses.clear();
}

function which(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("which", [command], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}
