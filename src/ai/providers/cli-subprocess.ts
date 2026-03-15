/**
 * CLI Subprocess Provider — claude, codex, gemini, llm
 *
 * 프로세스 관리 전략:
 * - spawn (not execFile): stdio 제어 + process group 관리
 * - Graceful shutdown: SIGTERM → 3초 대기 → SIGKILL
 * - Process group kill: -pid로 자식 트리 전체 종료
 * - ddmi 종료 시 남은 프로세스 자동 정리
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import type { AIProvider } from "../../types.js";
import { extractJSON } from "../utils.js";
import { logAICall } from "../logger.js";
import type { RateLimiter } from "../rate-limiter.js";

interface CLIConfig {
  command: string;
  args: string[];
  name: string;
  timeoutMs: number;
  /** stdin: 프롬프트를 stdin으로 전달, arg: args 마지막에 추가 */
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

// ─── Process Lifecycle Management ────────────────────────

/** 활성 프로세스 추적: pid → { child, startedAt } */
const activeProcesses = new Map<number, { child: ChildProcess; startedAt: number }>();

/** ddmi 종료 시 잔여 프로세스 정리 — 한 번만 등록 */
let cleanupRegistered = false;

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    for (const [pid, { child }] of activeProcesses) {
      killGracefully(child, pid);
    }
    activeProcesses.clear();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}

/** SIGTERM → 3초 대기 → SIGKILL (process group 단위) */
function killGracefully(child: ChildProcess, pid: number): void {
  try {
    // process group kill: 자식 프로세스 트리 전체에 SIGTERM
    process.kill(-pid, "SIGTERM");
  } catch {
    // process group이 없으면 개별 kill
    try { child.kill("SIGTERM"); } catch { /* already dead */ }
  }

  // 3초 후에도 살아있으면 SIGKILL
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      try { process.kill(-pid, "SIGKILL"); } catch {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }
    }
  }, 3000).unref(); // unref: 이 타이머가 Node 종료를 막지 않도록
}

// ─── Rate Limiter ────────────────────────────────────────

let sharedRateLimiter: RateLimiter | null = null;

export function setRateLimiter(limiter: RateLimiter): void {
  sharedRateLimiter = limiter;
}

// ─── Provider Factory ────────────────────────────────────

export function createCLIProvider(toolName: string): AIProvider {
  const config = CLI_TOOLS[toolName];
  if (!config) {
    throw new Error(
      `Unknown CLI tool: ${toolName}. Available: ${Object.keys(CLI_TOOLS).join(", ")}`,
    );
  }

  registerCleanup();
  const providerName = `cli:${toolName}`;

  return {
    name: providerName,

    async chat(prompt: string): Promise<string> {
      const estimatedTokens = Math.ceil(prompt.length / 4);
      sharedRateLimiter?.check(providerName, estimatedTokens);

      const start = Date.now();
      try {
        const result = await runCLI(config, prompt);
        sharedRateLimiter?.record(providerName);
        logAICall({
          provider: providerName, taskType: "chat",
          prompt, response: result,
          durationMs: Date.now() - start, success: true,
        });
        return result;
      } catch (err) {
        logAICall({
          provider: providerName, taskType: "chat",
          prompt, response: "",
          durationMs: Date.now() - start, success: false,
          error: (err as Error).message,
        });
        throw err;
      }
    },

    async chatJSON<T>(prompt: string): Promise<T> {
      const fullPrompt = prompt + "\n\nRespond with valid JSON only.";
      const estimatedTokens = Math.ceil(fullPrompt.length / 4);
      sharedRateLimiter?.check(providerName, estimatedTokens);

      const start = Date.now();
      try {
        const raw = await runCLI(config, fullPrompt);
        const parsed = extractJSON<T>(raw);
        sharedRateLimiter?.record(providerName);
        logAICall({
          provider: providerName, taskType: "chatJSON",
          prompt: fullPrompt, response: raw,
          durationMs: Date.now() - start, success: true,
        });
        return parsed;
      } catch (err) {
        logAICall({
          provider: providerName, taskType: "chatJSON",
          prompt: fullPrompt, response: "",
          durationMs: Date.now() - start, success: false,
          error: (err as Error).message,
        });
        throw err;
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        await which(config.command);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ─── Detection ───────────────────────────────────────────

export async function detectCLITools(): Promise<string[]> {
  const available: string[] = [];
  for (const [name, config] of Object.entries(CLI_TOOLS)) {
    try {
      await which(config.command);
      available.push(name);
    } catch { /* not installed */ }
  }
  return available;
}

// ─── Core: spawn-based CLI execution ─────────────────────

function runCLI(config: CLIConfig, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...config.args];
    if (config.promptMode === "arg") {
      args.push(prompt);
    }

    const child = spawn(config.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // 자체 process group 생성 → group kill 가능
      env: { ...process.env },
    });

    // process group ID = child.pid
    if (child.pid) {
      activeProcesses.set(child.pid, { child, startedAt: Date.now() });
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    // Timeout
    const timer = setTimeout(() => {
      if (child.pid) {
        killGracefully(child, child.pid);
      }
      reject(new Error(`${config.name} timeout after ${config.timeoutMs}ms`));
    }, config.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (child.pid) activeProcesses.delete(child.pid);

      if (code !== 0) {
        reject(new Error(`${config.name} exited with code ${code}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (child.pid) activeProcesses.delete(child.pid);
      reject(new Error(`${config.name} spawn error: ${err.message}`));
    });

    // stdin 전달
    if (config.promptMode === "stdin" && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

// ─── Monitoring ──────────────────────────────────────────

/** 현재 활성 CLI 프로세스 정보 */
export function getActiveProcesses(): Array<{ pid: number; runningMs: number }> {
  const now = Date.now();
  return [...activeProcesses.entries()].map(([pid, { startedAt }]) => ({
    pid,
    runningMs: now - startedAt,
  }));
}

/** 남은 프로세스 강제 종료 (router.shutdown에서 호출) */
export function cleanupProcesses(): void {
  for (const [pid, { child }] of activeProcesses) {
    killGracefully(child, pid);
  }
  activeProcesses.clear();
}

// ─── Utility ─────────────────────────────────────────────

function which(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("which", [command], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}
