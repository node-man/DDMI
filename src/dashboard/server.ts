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
  searchBM25,
} from "../storage/sqlite.js";
import { createAuditTrail } from "../core/audit.js";

export function startDashboard(db: Database.Database, dbPath: string, port: number = 3000): void {
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
