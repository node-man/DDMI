/**
 * MCP Server — @modelcontextprotocol/sdk 기반
 *
 * stdio transport로 AI Agent와 통신.
 * 등록 도구: context_assemble, context_feedback, knowledge_query
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../core/config.js";
import { initVectorStore } from "../storage/lance.js";
import { initDatabase } from "../storage/sqlite.js";
import { createRouter } from "../ai/router.js";
import type { CuratorDeps } from "../core/curator.js";
import type { AIProvider } from "../types.js";
import {
  TOOL_SCHEMA as ASSEMBLE_SCHEMA,
  handleContextAssemble,
} from "./tools/context-assemble.js";
import {
  TOOL_SCHEMA as FEEDBACK_SCHEMA,
  handleContextFeedback,
} from "./tools/context-feedback.js";
import {
  TOOL_SCHEMA as KNOWLEDGE_SCHEMA,
  handleKnowledgeQuery,
} from "./tools/knowledge-query.js";

export async function startServer(projectRoot: string): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const lancePath = join(ddmiDir, "vectors.lance");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  // Initialize deps
  const config = loadConfig(projectRoot);
  const router = await createRouter(config);
  const lance = await initVectorStore(lancePath);
  const db = initDatabase(dbPath);

  const curatorDeps: CuratorDeps = {
    embedder: router.getEmbeddingProvider(),
    lance,
    dbPath,
    weights: config.curator.weights,
  };

  const aiProvider: AIProvider | null = router.getProvider();
  const level = router.getDegradationLevel();

  // Log provider status to stderr (not stdout — MCP uses stdout)
  const providers = router.getAvailableProviders();
  console.error(
    `ddmi MCP server: Level ${level} | Providers: ${providers.length > 0 ? providers.join(", ") : "none"}`,
  );

  // Create MCP server
  const server = new Server(
    { name: config.server.name, version: config.server.version },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [ASSEMBLE_SCHEMA, FEEDBACK_SCHEMA, KNOWLEDGE_SCHEMA],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "context_assemble":
        return handleContextAssemble(curatorDeps, args ?? {});

      case "context_feedback":
        return handleContextFeedback(db, args ?? {});

      case "knowledge_query":
        return handleKnowledgeQuery(curatorDeps, aiProvider, args ?? {});

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Server runs until process exits
  process.on("SIGINT", () => {
    db.close();
    process.exit(0);
  });
}
