/**
 * CLI Subprocess Provider — claude, codex, gemini, llm 등
 *
 * CLI-first 전략의 핵심: 사용자의 기존 CLI 구독을 활용하여 $0 비용.
 * 긴 프롬프트는 임시 파일 + stdin pipe로 전달.
 */

import { execFile } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AIProvider } from "../../types.js";
import { extractJSON } from "../utils.js";

interface CLIConfig {
  command: string;
  args: string[];
  name: string;
  timeoutMs?: number;
}

const CLI_TOOLS: Record<string, CLIConfig> = {
  claude: {
    command: "claude",
    args: ["-p", "--output-format", "text"],
    name: "Claude CLI",
    timeoutMs: 60000,
  },
  codex: {
    command: "codex",
    args: ["-q"],
    name: "Codex CLI",
    timeoutMs: 60000,
  },
  gemini: {
    command: "gemini",
    args: ["prompt"],
    name: "Gemini CLI",
    timeoutMs: 60000,
  },
  llm: {
    command: "llm",
    args: [],
    name: "llm CLI",
    timeoutMs: 60000,
  },
};

export function createCLIProvider(toolName: string): AIProvider {
  const config = CLI_TOOLS[toolName];
  if (!config) {
    throw new Error(
      `Unknown CLI tool: ${toolName}. Available: ${Object.keys(CLI_TOOLS).join(", ")}`,
    );
  }

  return {
    name: `cli:${toolName}`,

    async chat(prompt: string): Promise<string> {
      return runCLI(config, prompt);
    },

    async chatJSON<T>(prompt: string): Promise<T> {
      const raw = await runCLI(config, prompt + "\n\nRespond with valid JSON only.");
      return extractJSON<T>(raw);
    },

    async healthCheck(): Promise<boolean> {
      try {
        await runCLI(config, "Respond with: ok", 5000);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Detect which CLI tools are available on this system.
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

function runCLI(
  config: CLIConfig,
  prompt: string,
  timeoutMs?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs ?? config.timeoutMs ?? 60000;

    // For long prompts, use a temp file
    let tmpPath: string | null = null;
    let args = [...config.args];

    if (prompt.length > 2000) {
      tmpPath = join(tmpdir(), `ddmi-prompt-${randomUUID()}.txt`);
      writeFileSync(tmpPath, prompt, "utf-8");
    }

    const child = execFile(
      config.command,
      args,
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        // Clean up temp file
        if (tmpPath) {
          try { unlinkSync(tmpPath); } catch { /* ignore */ }
        }

        if (error) {
          reject(new Error(`${config.name} failed: ${error.message}\nstderr: ${stderr}`));
          return;
        }

        resolve(stdout.trim());
      },
    );

    // Feed prompt via stdin
    if (child.stdin) {
      if (tmpPath) {
        // Pipe temp file content
        const content = prompt;
        child.stdin.write(content);
      } else {
        child.stdin.write(prompt);
      }
      child.stdin.end();
    }
  });
}

function which(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("which", [command], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}
