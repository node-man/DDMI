/**
 * Dashboard Server — Hono API + React SPA 서빙
 *
 * API: /api/* 엔드포인트
 * SPA: dist/client/ 정적 파일 (프로덕션) 또는 Vite proxy (개발)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type Database from "better-sqlite3";
import {
  getFileCount,
  getChunkCount,
  getRelationCount,
  getConflictCount,
  getOpenConflicts,
  resolveConflict,
  getAuditEvents,
  getAllFiles,
  getChunksByFileId,
  getAllRelations,
  searchBM25,
} from "../storage/sqlite.js";
import { createAuditTrail } from "../core/audit.js";
import type { AIProvider } from "../types.js";
import type { CuratorDeps } from "../core/curator.js";

// ─── Index Status (in-memory) ──────────────────────────────

interface IndexState {
  running: boolean;
  progress: string;
  lastResult: string;
  lastIndexedAt: string;
}

const indexState: IndexState = {
  running: false,
  progress: "",
  lastResult: "",
  lastIndexedAt: "",
};

// ─── Dashboard Options ─────────────────────────────────────

export interface DashboardOptions {
  /** 요청 시점에 최신 curatorDeps를 반환하는 factory */
  getCuratorDeps: () => Promise<CuratorDeps | null>;
  /** 요청 시점에 최신 aiProvider를 반환하는 factory */
  getAIProvider: () => Promise<AIProvider | null>;
  projectRoot?: string;
}

export function startDashboard(
  db: Database.Database,
  dbPath: string,
  port: number = 3000,
  options: DashboardOptions,
): void {
  const { getCuratorDeps, getAIProvider, projectRoot } = options;
  const app = new Hono();

  // ─── API: Health ───────────────────────────────────────
  app.get("/api/health", (c) => {
    const trail = createAuditTrail(dbPath);
    const chain = trail.verifyChain();

    return c.json({
      files: getFileCount(db),
      chunks: getChunkCount(db),
      relations: getRelationCount(db),
      openConflicts: getConflictCount(db),
      auditEvents: trail.getEvents({}).length,
      chainValid: chain.valid,
      chainChecked: chain.checkedCount,
    });
  });

  // ─── API: Conflicts ────────────────────────────────────
  app.get("/api/conflicts", (c) => {
    const conflicts = getOpenConflicts(db);
    return c.json(conflicts);
  });

  app.post("/api/conflicts/:id/resolve", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ resolvedBy: string; note: string }>();

    const changed = resolveConflict(db, id, body.resolvedBy ?? "human", body.note ?? "");

    if (!changed) {
      return c.json({ success: false, error: "Conflict not found or already resolved" }, 404);
    }

    const trail = createAuditTrail(dbPath);
    trail.log({
      eventType: "conflict_resolved",
      actor: body.resolvedBy ?? "human",
      details: { conflictId: id, note: body.note },
      rationale: body.note,
    });

    return c.json({ success: true });
  });

  // ─── API: Conflict AI Analysis ──────────────────────────
  app.post("/api/conflicts/:id/analyze", async (c) => {
    const id = c.req.param("id");

    const aiProvider = await getAIProvider();
    if (!aiProvider) {
      return c.json({ error: "No AI provider available. Install claude CLI, Ollama, or configure an API key." }, 400);
    }

    // Find the conflict
    const conflicts = getOpenConflicts(db);
    const conflict = conflicts.find((cf) => cf.id === id);
    if (!conflict) {
      return c.json({ error: "Conflict not found" }, 404);
    }

    // Get chunk content for both sides
    const chunkA = db.prepare("SELECT content, section_path FROM chunks WHERE id = ?").get(conflict.chunkAId) as
      | { content: string; section_path: string }
      | undefined;
    const chunkB = db.prepare("SELECT content, section_path FROM chunks WHERE id = ?").get(conflict.chunkBId) as
      | { content: string; section_path: string }
      | undefined;

    if (!chunkA || !chunkB) {
      return c.json({ error: "One or both chunks not found in database" }, 404);
    }

    const prompt = `Analyze this conflict between two document chunks. Explain what they contradict, the potential impact, and suggest how to resolve it.

Severity: ${conflict.severity}
Description: ${conflict.description}

Chunk A (${conflict.chunkAId}):
Section: ${chunkA.section_path}
${chunkA.content.slice(0, 1000)}

Chunk B (${conflict.chunkBId}):
Section: ${chunkB.section_path}
${chunkB.content.slice(0, 1000)}

Provide a concise analysis in 3 sections:
1. **Contradiction**: What exactly contradicts
2. **Impact**: What could go wrong if unresolved
3. **Resolution**: Suggested fix`;

    try {
      const analysis = await aiProvider.chat(prompt);
      return c.json({ analysis });
    } catch (err) {
      return c.json({ error: `AI analysis failed: ${(err as Error).message}` }, 500);
    }
  });

  // ─── API: Audit ────────────────────────────────────────
  app.get("/api/audit", (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const type = c.req.query("type");
    const file = c.req.query("file");

    const events = getAuditEvents(db, {
      limit,
      eventType: type as any,
      targetFile: file ?? undefined,
    });
    return c.json(events);
  });

  // ─── API: Files (Explorer) ─────────────────────────────
  app.get("/api/files", (c) => {
    const files = getAllFiles(db);
    return c.json(files);
  });

  app.get("/api/files/:id/chunks", (c) => {
    const chunks = getChunksByFileId(db, c.req.param("id"));
    return c.json(chunks);
  });

  // ─── API: Search (BM25) ──────────────────────────────
  app.get("/api/search", (c) => {
    const q = c.req.query("q");
    if (!q) return c.json([]);
    const results = searchBM25(db, q, 20);
    return c.json(results);
  });

  // ─── API: Providers ─────────────────────────────────────
  app.get("/api/providers", async (c) => {
    const providers: Array<{
      name: string;
      type: "cli" | "ollama";
      status: "available" | "unavailable";
      models?: string[];
    }> = [];

    // Detect CLI tools
    try {
      const { detectCLITools } = await import("../ai/providers/cli-subprocess.js");
      const cliTools = await detectCLITools();
      for (const name of cliTools) {
        providers.push({ name: `cli:${name}`, type: "cli", status: "available" });
      }
    } catch {
      // CLI detection failed — not critical
    }

    // Ollama check
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const models = data.models?.map((m) => m.name) ?? [];
        providers.push({ name: "ollama", type: "ollama", status: "available", models });
      }
    } catch {
      // Ollama not available
    }

    return c.json(providers);
  });

  // ─── API: Index ─────────────────────────────────────────
  app.post("/api/index", async (c) => {
    if (indexState.running) {
      return c.json({ started: false, error: "Indexing already in progress" }, 409);
    }

    const body = await c.req.json<{ provider?: string; incremental?: boolean }>().catch(() => ({}));
    const provider = (body as { provider?: string }).provider;
    const incremental = (body as { incremental?: boolean }).incremental ?? false;

    // Resolve CLI entry point
    const cliMain = join(import.meta.dirname, "../cli/main.js");
    if (!existsSync(cliMain)) {
      return c.json({ started: false, error: "CLI not built. Run npx tsc first." }, 500);
    }

    const args = [cliMain, "index"];
    if (provider) args.push("--provider", provider);
    if (incremental) args.push("--incremental");

    indexState.running = true;
    indexState.progress = "Starting...";
    indexState.lastResult = "";

    execFile(process.execPath, args, {
      timeout: 300000,
      cwd: projectRoot ?? process.cwd(),
    }, (err, stdout, stderr) => {
      indexState.running = false;
      indexState.lastIndexedAt = new Date().toISOString();
      if (err) {
        indexState.lastResult = `Error: ${err.message}`;
        indexState.progress = "Failed";
      } else {
        indexState.lastResult = (stdout + stderr).trim().slice(-500);
        indexState.progress = "Completed";
      }
    });

    return c.json({ started: true });
  });

  app.get("/api/index/status", (c) => {
    return c.json({
      running: indexState.running,
      progress: indexState.progress,
      lastResult: indexState.lastResult,
      lastIndexedAt: indexState.lastIndexedAt || undefined,
    });
  });

  // ─── API: Knowledge Query ──────────────────────────────
  app.post("/api/knowledge-query", async (c) => {
    const body = await c.req.json<{ question: string }>();
    const question = body.question;

    if (!question || typeof question !== "string") {
      return c.json({ error: "Missing 'question' field" }, 400);
    }

    const curatorDeps = await getCuratorDeps();
    const aiProvider = await getAIProvider();

    if (!curatorDeps) {
      return c.json({
        error: "Context curator not available. Ensure the project is indexed.",
      }, 500);
    }

    const { handleKnowledgeQuery } = await import("../mcp/tools/knowledge-query.js");
    const result = await handleKnowledgeQuery(curatorDeps, aiProvider, { question });

    return c.json({ answer: result.content[0].text });
  });

  // ─── API: Graph (Knowledge Graph) ─────────────────────
  app.get("/api/graph", (c) => {
    const files = getAllFiles(db);
    const nodes = files.map((f) => ({
      id: f.id,
      label: f.path,
      docType: f.docType,
      totalTokens: f.totalTokens,
    }));

    // chunk → file 매핑
    const chunkToFile = new Map<string, string>();
    for (const file of files) {
      const chunks = getChunksByFileId(db, file.id);
      for (const chunk of chunks) {
        chunkToFile.set(chunk.id, file.id);
      }
    }

    // 관계를 파일 레벨 엣지로 변환
    const allRelations = getAllRelations(db);
    const edgeDedup = new Map<string, { id: string; source: string; target: string; type: string }>();

    for (const rel of allRelations) {
      const source = chunkToFile.get(rel.sourceChunkId);
      const target = chunkToFile.get(rel.targetChunkId);
      if (!source || !target || source === target) continue;

      // 같은 source-target 쌍은 하나의 엣지로 합침
      const key = `${source}-${target}-${rel.relationType}`;
      if (!edgeDedup.has(key)) {
        edgeDedup.set(key, {
          id: rel.id,
          source,
          target,
          type: rel.relationType,
        });
      }
    }

    return c.json({ nodes, edges: Array.from(edgeDedup.values()) });
  });

  // ─── SPA: React 정적 파일 서빙 (프로덕션) ──────────────
  const clientDist = join(import.meta.dirname, "../../dist/client");

  if (existsSync(clientDist)) {
    // 정적 에셋 (JS, CSS, 이미지)
    app.get("/assets/*", (c) => {
      const filePath = join(clientDist, c.req.path);
      if (!existsSync(filePath)) return c.notFound();
      const content = readFileSync(filePath);
      const ext = filePath.split(".").pop();
      const mime: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
      };
      return c.body(content, 200, {
        "Content-Type": mime[ext ?? ""] ?? "application/octet-stream",
      });
    });

    // SPA fallback: 모든 비-API 경로 → index.html
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.notFound();
      return c.html(readFileSync(join(clientDist, "index.html"), "utf-8"));
    });
  }

  // ─── Start ─────────────────────────────────────────────
  serve({ fetch: app.fetch, port }, () => {
    console.error(`ddmi dashboard: http://localhost:${port}`);
  });
}
