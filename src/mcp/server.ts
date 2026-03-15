/**
 * MCP Server — @modelcontextprotocol/sdk 기반
 *
 * stdio transport로 AI Agent와 통신.
 * 등록 도구: context_assemble, context_feedback
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createEmbedder } from "../core/embedder.js";
import { initVectorStore } from "../storage/lance.js";
import { initDatabase } from "../storage/sqlite.js";
import type { CuratorDeps } from "../core/curator.js";
import {
  TOOL_SCHEMA as ASSEMBLE_SCHEMA,
  handleContextAssemble,
} from "./tools/context-assemble.js";
import {
  TOOL_SCHEMA as FEEDBACK_SCHEMA,
  handleContextFeedback,
} from "./tools/context-feedback.js";

export async function startServer(projectRoot: string): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const lancePath = join(ddmiDir, "vectors.lance");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  // Initialize deps
  const embedder = await createEmbedder();
  const lance = await initVectorStore(lancePath);
  const db = initDatabase(dbPath);

  const curatorDeps: CuratorDeps = {
    embedder,
    lance,
    dbPath,
  };

  // Create MCP server
  const server = new Server(
    { name: "ddmi", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [ASSEMBLE_SCHEMA, FEEDBACK_SCHEMA],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "context_assemble":
        return handleContextAssemble(curatorDeps, args ?? {});

      case "context_feedback":
        return handleContextFeedback(db, args ?? {});

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
