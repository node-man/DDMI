/**
 * Dashboard Server — Hono + htmx
 *
 * Mission Control: Health, Conflicts, Audit 3페이지.
 * localhost:3000에서 서빙.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
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
} from "../storage/sqlite.js";
import { createAuditTrail } from "../core/audit.js";

export function startDashboard(db: Database.Database, dbPath: string, port: number = 3000): void {
  const app = new Hono();
  // HTML/CSS는 src/ 디렉토리에서 직접 읽음 (tsc가 복사 안 하므로)
  const srcRoot = join(import.meta.dirname, "../../src/dashboard");
  const pagesDir = join(srcRoot, "pages");
  const staticDir = join(srcRoot, "static");

  // ─── Static ────────────────────────────────────────────
  app.get("/style.css", (c) => {
    return c.body(readFileSync(join(staticDir, "style.css"), "utf-8"), 200, {
      "Content-Type": "text/css",
    });
  });

  // ─── Pages ─────────────────────────────────────────────
  app.get("/", (c) => c.html(readFileSync(join(pagesDir, "index.html"), "utf-8")));
  app.get("/conflicts", (c) => c.html(readFileSync(join(pagesDir, "conflicts.html"), "utf-8")));
  app.get("/audit", (c) => c.html(readFileSync(join(pagesDir, "audit.html"), "utf-8")));

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

    resolveConflict(db, id, body.resolvedBy ?? "human", body.note ?? "");

    // Audit log
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

  // ─── Start ─────────────────────────────────────────────
  serve({ fetch: app.fetch, port }, () => {
    console.error(`ddmi dashboard: http://localhost:${port}`);
  });
}
