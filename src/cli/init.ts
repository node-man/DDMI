/**
 * ddmi init — 프로젝트 초기화
 *
 * .ddmi/ 디렉토리 생성, config.toml 기본값, SQLite 초기화,
 * .gitignore 업데이트, .mcp.json 생성
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../storage/sqlite.js";
import { DEFAULT_CONFIG } from "../types.js";
import { detectCLITools } from "../ai/providers/cli-subprocess.js";
import { createOllamaProvider } from "../ai/providers/ollama.js";

const CONFIG_TOML = `# ddmi — Document-Driven Memory Infrastructure
# Configuration file. See docs/DDMI.md for full reference.

[server]
transport = "stdio"
name = "ddmi"
version = "0.1.0"

[embedding]
provider = "transformers"
model = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
# English-only: model = "Xenova/all-MiniLM-L6-v2"

[curator]
default_max_tokens = 8000

[curator.weights]
semantic_sim = 0.55
keyword_boost = 0.15
task_aware_authority = 0.15
recency = 0.15
redundancy_penalty = 1.5

[ai]
default_provider = "auto"  # auto | claude | codex | gemini | ollama | llm
ollama_url = "http://localhost:11434"
ollama_model = "qwen3.5:9b"

[watcher]
enabled = true
debounce_ms = 2000
ignore_patterns = ["node_modules", ".git", ".ddmi"]
`;

const MCP_JSON = `{
  "mcpServers": {
    "ddmi": {
      "command": "ddmi",
      "args": ["serve", "--watch"]
    }
  }
}
`;

export async function runInit(projectRoot: string): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const configPath = join(ddmiDir, "config.toml");
  const dbPath = join(ddmiDir, "index.db");
  const mcpPath = join(projectRoot, ".mcp.json");
  const gitignorePath = join(projectRoot, ".gitignore");

  // Check if already initialized
  if (existsSync(ddmiDir)) {
    console.log("ddmi is already initialized in this project.");
    console.log(`  Config: ${configPath}`);
    return;
  }

  // Create .ddmi/
  mkdirSync(ddmiDir, { recursive: true });
  console.log("  Created .ddmi/");

  // Write config.toml
  writeFileSync(configPath, CONFIG_TOML, "utf-8");
  console.log("  Created .ddmi/config.toml");

  // Initialize SQLite
  const db = initDatabase(dbPath);
  db.close();
  console.log("  Created .ddmi/index.db");

  // Create .mcp.json (if not exists)
  if (!existsSync(mcpPath)) {
    writeFileSync(mcpPath, MCP_JSON, "utf-8");
    console.log("  Created .mcp.json");
  }

  // Add .ddmi/ to .gitignore
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".ddmi")) {
      appendFileSync(gitignorePath, "\n# ddmi index\n.ddmi/\n");
      console.log("  Added .ddmi/ to .gitignore");
    }
  }

  // Detect AI providers
  const providers: string[] = [];

  const cliTools = await detectCLITools();
  providers.push(...cliTools);

  // Ollama: HTTP healthCheck (/api/tags — LLM 호출 아님)
  const ollama = createOllamaProvider(
    DEFAULT_CONFIG.ai.ollamaUrl,
    DEFAULT_CONFIG.ai.ollamaModel,
  );
  if (await ollama.healthCheck()) {
    providers.push(`ollama:${DEFAULT_CONFIG.ai.ollamaModel}`);
  }

  if (providers.length > 0) {
    console.log(`  AI providers detected: ${providers.join(", ")} (Level 2)`);
  } else {
    console.log("  AI providers: none detected (Level 1 — embedding only)");
  }

  console.log("\nddmi initialized successfully!");
  console.log("Next: Run 'ddmi index' to index your MD files.");
}
