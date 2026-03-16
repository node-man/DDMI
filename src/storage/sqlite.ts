/**
 * SQLite Storage — Drizzle ORM 래퍼
 *
 * .ddmi/index.db에 메타데이터, 청크, 피드백을 저장한다.
 * WAL 모드 활성화로 동시 읽기 성능 확보.
 *
 * Drizzle ORM으로 CRUD 처리, FTS5 virtual table만 raw SQL 유지.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, and, desc, asc, count, sql, or, lt } from "drizzle-orm";
import * as schema from "./schema.js";
import type {
  FileRecord,
  ChunkRecord,
  FeedbackRecord,
  FeedbackInput,
  ScoringWeights,
  Relation,
  Conflict,
  AuditEvent,
  AuditFilter,
} from "../types.js";

// ─── Schema ──────────────────────────────────────────────
// NOTE: 테이블 구조의 진실원은 schema.ts (Drizzle ORM 정의).
// 이 SQL은 initDatabase() DDL용으로만 사용.
// FTS5 virtual table은 Drizzle가 지원하지 않아 raw SQL 유지 필수.
// 테이블 구조 변경 시 schema.ts와 반드시 동기화할 것.

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  doc_type TEXT,
  frontmatter JSON,
  checksum TEXT,
  total_tokens INTEGER,
  completeness_score REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  section_path TEXT,
  content TEXT NOT NULL,
  token_count INTEGER,
  heading_level INTEGER,
  chunk_type TEXT DEFAULT 'prose',
  metadata JSON,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);

CREATE TABLE IF NOT EXISTS feedback_log (
  id TEXT PRIMARY KEY,
  feedback_token TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  intent TEXT,
  task_type TEXT,
  outcome TEXT,
  blocks_served JSON,
  blocks_used JSON,
  blocks_irrelevant JSON,
  missing_context TEXT,
  scoring_weights JSON
);
CREATE INDEX IF NOT EXISTS idx_feedback_token ON feedback_log(feedback_token);
CREATE INDEX IF NOT EXISTS idx_feedback_outcome ON feedback_log(outcome);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_chunk_id TEXT NOT NULL,
  target_chunk_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  extraction_method TEXT,
  metadata JSON,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_chunk_id);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  chunk_a_id TEXT NOT NULL,
  chunk_b_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open',
  resolved_by TEXT,
  resolved_at TEXT,
  resolution_note TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  actor TEXT,
  target_file TEXT,
  target_chunk_id TEXT,
  details JSON NOT NULL,
  rationale TEXT,
  based_on JSON,
  previous_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_target_file ON audit_log(target_file);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

CREATE TABLE IF NOT EXISTS ai_task_queue (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'batch',
  status TEXT NOT NULL DEFAULT 'pending',
  worker_id TEXT,
  payload JSON NOT NULL,
  result JSON,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_aitask_status ON ai_task_queue(status, priority);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  file_id UNINDEXED,
  file_path UNINDEXED,
  section_path,
  content,
  doc_type UNINDEXED,
  token_count UNINDEXED,
  tokenize='unicode61'
);
`;

// ─── Drizzle instance cache ──────────────────────────────

const drizzleCache = new WeakMap<Database.Database, BetterSQLite3Database<typeof schema>>();

function getDrizzle(db: Database.Database): BetterSQLite3Database<typeof schema> {
  let d = drizzleCache.get(db);
  if (!d) {
    d = drizzle(db, { schema });
    drizzleCache.set(db, d);
  }
  return d;
}

// ─── Init ────────────────────────────────────────────────

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  // Warm up the Drizzle instance
  getDrizzle(db);
  return db;
}

// ─── Files ───────────────────────────────────────────────

export function upsertFile(db: Database.Database, file: FileRecord): void {
  const d = getDrizzle(db);
  d.insert(schema.files)
    .values({
      id: file.id,
      path: file.path,
      title: file.title,
      docType: file.docType,
      frontmatter: file.frontmatter,
      checksum: file.checksum,
      totalTokens: file.totalTokens,
      completenessScore: file.completenessScore,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      indexedAt: file.indexedAt,
    })
    .onConflictDoUpdate({
      target: schema.files.id,
      set: {
        title: file.title,
        docType: file.docType,
        frontmatter: file.frontmatter,
        checksum: file.checksum,
        totalTokens: file.totalTokens,
        completenessScore: file.completenessScore,
        updatedAt: file.updatedAt,
        indexedAt: file.indexedAt,
      },
    })
    .run();
}

export function getFileByPath(
  db: Database.Database,
  path: string,
): FileRecord | null {
  const d = getDrizzle(db);
  const row = d
    .select()
    .from(schema.files)
    .where(eq(schema.files.path, path))
    .get();
  return row ? drizzleRowToFileRecord(row) : null;
}

export function getFileByChecksum(
  db: Database.Database,
  path: string,
): string | null {
  const d = getDrizzle(db);
  const row = d
    .select({ checksum: schema.files.checksum })
    .from(schema.files)
    .where(eq(schema.files.path, path))
    .get();
  return row?.checksum ?? null;
}

export function getAllFiles(db: Database.Database): FileRecord[] {
  const d = getDrizzle(db);
  const rows = d
    .select()
    .from(schema.files)
    .orderBy(asc(schema.files.path))
    .all();
  return rows.map(drizzleRowToFileRecord);
}

export function deleteFile(db: Database.Database, fileId: string): void {
  const d = getDrizzle(db);
  d.delete(schema.files).where(eq(schema.files.id, fileId)).run();
  // chunks cascade via ON DELETE CASCADE
}

// ─── Chunks ──────────────────────────────────────────────

export function insertChunks(
  db: Database.Database,
  chunks: ChunkRecord[],
): void {
  if (chunks.length === 0) return;
  const d = getDrizzle(db);
  d.insert(schema.chunks)
    .values(
      chunks.map((chunk) => ({
        id: chunk.id,
        fileId: chunk.fileId,
        sectionPath: chunk.sectionPath,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        headingLevel: chunk.headingLevel,
        chunkType: chunk.chunkType,
        metadata: chunk.metadata,
        createdAt: chunk.createdAt,
      })),
    )
    .run();
}

export function getChunksByFileId(
  db: Database.Database,
  fileId: string,
): ChunkRecord[] {
  const d = getDrizzle(db);
  const rows = d
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.fileId, fileId))
    .all();
  return rows.map(drizzleRowToChunkRecord);
}

export function deleteChunksByFileId(
  db: Database.Database,
  fileId: string,
): void {
  const d = getDrizzle(db);
  d.delete(schema.chunks).where(eq(schema.chunks.fileId, fileId)).run();
}

export function getChunkCount(db: Database.Database): number {
  const d = getDrizzle(db);
  const row = d.select({ count: count() }).from(schema.chunks).get();
  return row?.count ?? 0;
}

export function getFileCount(db: Database.Database): number {
  const d = getDrizzle(db);
  const row = d.select({ count: count() }).from(schema.files).get();
  return row?.count ?? 0;
}

// ─── Feedback ────────────────────────────────────────────

let feedbackCounter = 0;

export function generateFeedbackId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  feedbackCounter++;
  return `FB-${dateStr}-${String(feedbackCounter).padStart(3, "0")}`;
}

export function saveFeedback(
  db: Database.Database,
  token: string,
  input: FeedbackInput,
  meta: {
    intent: string;
    taskType: string;
    blocksServed: string[];
    scoringWeights: ScoringWeights;
  },
): FeedbackRecord {
  const id = generateFeedbackId();
  const timestamp = new Date().toISOString();

  const record: FeedbackRecord = {
    ...input,
    id,
    timestamp,
    intent: meta.intent,
    taskType: meta.taskType,
    blocksServed: meta.blocksServed,
    scoringWeights: meta.scoringWeights,
  };

  const d = getDrizzle(db);
  d.insert(schema.feedbackLog)
    .values({
      id: record.id,
      feedbackToken: token,
      timestamp,
      intent: meta.intent,
      taskType: meta.taskType,
      outcome: input.outcome,
      blocksServed: meta.blocksServed,
      blocksUsed: input.blocksUsed ?? [],
      blocksIrrelevant: input.blocksIrrelevant ?? [],
      missingContext: input.missingContext ?? null,
      scoringWeights: meta.scoringWeights,
    })
    .run();

  return record;
}

// ─── Relations ──────────────────────────────────────────

export function insertRelation(db: Database.Database, r: Relation): void {
  const d = getDrizzle(db);
  d.insert(schema.relations)
    .values({
      id: r.id,
      sourceChunkId: r.sourceChunkId,
      targetChunkId: r.targetChunkId,
      relationType: r.relationType,
      confidence: r.confidence,
      extractionMethod: r.extractionMethod,
      metadata: r.metadata,
      createdAt: r.createdAt,
    })
    .onConflictDoUpdate({
      target: schema.relations.id,
      set: {
        sourceChunkId: r.sourceChunkId,
        targetChunkId: r.targetChunkId,
        relationType: r.relationType,
        confidence: r.confidence,
        extractionMethod: r.extractionMethod,
        metadata: r.metadata,
        createdAt: r.createdAt,
      },
    })
    .run();
}

export function insertRelations(db: Database.Database, relations: Relation[]): void {
  if (relations.length === 0) return;
  const d = getDrizzle(db);
  for (const r of relations) {
    d.insert(schema.relations)
      .values({
        id: r.id,
        sourceChunkId: r.sourceChunkId,
        targetChunkId: r.targetChunkId,
        relationType: r.relationType,
        confidence: r.confidence,
        extractionMethod: r.extractionMethod,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })
      .onConflictDoUpdate({
        target: schema.relations.id,
        set: {
          sourceChunkId: r.sourceChunkId,
          targetChunkId: r.targetChunkId,
          relationType: r.relationType,
          confidence: r.confidence,
          extractionMethod: r.extractionMethod,
          metadata: r.metadata,
          createdAt: r.createdAt,
        },
      })
      .run();
  }
}

export function getRelationsForChunk(db: Database.Database, chunkId: string): Relation[] {
  const d = getDrizzle(db);
  const rows = d
    .select()
    .from(schema.relations)
    .where(
      or(
        eq(schema.relations.sourceChunkId, chunkId),
        eq(schema.relations.targetChunkId, chunkId),
      ),
    )
    .all();
  return rows.map(drizzleRowToRelation);
}

export function deleteRelationsByFileChunks(db: Database.Database, chunkIds: string[]): void {
  if (chunkIds.length === 0) return;
  const placeholders = chunkIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM relations WHERE source_chunk_id IN (${placeholders}) OR target_chunk_id IN (${placeholders})`).run(...chunkIds, ...chunkIds);
}

export function getAllRelations(db: Database.Database): Relation[] {
  const d = getDrizzle(db);
  const rows = d.select().from(schema.relations).all();
  return rows.map(drizzleRowToRelation);
}

export function getRelationCount(db: Database.Database): number {
  const d = getDrizzle(db);
  const row = d.select({ count: count() }).from(schema.relations).get();
  return row?.count ?? 0;
}

// ─── Conflicts ──────────────────────────────────────────

export function insertConflict(db: Database.Database, c: Conflict): void {
  const d = getDrizzle(db);
  d.insert(schema.conflicts)
    .values({
      id: c.id,
      chunkAId: c.chunkAId,
      chunkBId: c.chunkBId,
      severity: c.severity,
      description: c.description,
      status: c.status,
      detectedAt: c.detectedAt,
    })
    .onConflictDoUpdate({
      target: schema.conflicts.id,
      set: {
        chunkAId: c.chunkAId,
        chunkBId: c.chunkBId,
        severity: c.severity,
        description: c.description,
        status: c.status,
        detectedAt: c.detectedAt,
      },
    })
    .run();
}

export function getOpenConflicts(db: Database.Database): Conflict[] {
  const d = getDrizzle(db);
  const rows = d
    .select()
    .from(schema.conflicts)
    .where(eq(schema.conflicts.status, "open"))
    .orderBy(desc(schema.conflicts.detectedAt))
    .all();
  return rows.map(drizzleRowToConflict);
}

export function resolveConflict(
  db: Database.Database,
  conflictId: string,
  resolvedBy: string,
  note: string,
): boolean {
  const d = getDrizzle(db);
  const result = d
    .update(schema.conflicts)
    .set({
      status: "resolved",
      resolvedBy,
      resolvedAt: new Date().toISOString(),
      resolutionNote: note,
    })
    .where(
      and(
        eq(schema.conflicts.id, conflictId),
        eq(schema.conflicts.status, "open"),
      ),
    )
    .run();
  return result.changes > 0;
}

export function getConflictCount(db: Database.Database): number {
  const d = getDrizzle(db);
  const row = d
    .select({ count: count() })
    .from(schema.conflicts)
    .where(eq(schema.conflicts.status, "open"))
    .get();
  return row?.count ?? 0;
}

// ─── Audit Log ──────────────────────────────────────────

export function insertAuditEvent(db: Database.Database, e: AuditEvent): void {
  const d = getDrizzle(db);
  d.insert(schema.auditLog)
    .values({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp,
      actor: e.actor,
      targetFile: e.targetFile ?? null,
      targetChunkId: e.targetChunkId ?? null,
      details: e.details,
      rationale: e.rationale ?? null,
      basedOn: e.basedOn ?? null,
      previousHash: e.previousHash,
      hash: e.hash,
    })
    .run();
}

export function getAuditEvents(db: Database.Database, filter?: AuditFilter): AuditEvent[] {
  // Dynamic WHERE + optional LIMIT is awkward with Drizzle's builder,
  // so we keep raw SQL for this one query which has variable conditions.
  let sqlStr = "SELECT * FROM audit_log WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.eventType) { sqlStr += " AND event_type = ?"; params.push(filter.eventType); }
  if (filter?.targetFile) { sqlStr += " AND target_file = ?"; params.push(filter.targetFile); }
  if (filter?.after) { sqlStr += " AND timestamp > ?"; params.push(filter.after); }
  if (filter?.before) { sqlStr += " AND timestamp < ?"; params.push(filter.before); }

  sqlStr += " ORDER BY timestamp DESC";
  if (filter?.limit) { sqlStr += " LIMIT ?"; params.push(filter.limit); }

  const rows = db.prepare(sqlStr).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rawRowToAuditEvent);
}

export function getLatestAuditHash(db: Database.Database): string {
  const d = getDrizzle(db);
  const row = d
    .select({ hash: schema.auditLog.hash })
    .from(schema.auditLog)
    .orderBy(sql`rowid DESC`)
    .limit(1)
    .get();
  return row?.hash ?? "genesis";
}

export function getAllAuditEvents(db: Database.Database): AuditEvent[] {
  const d = getDrizzle(db);
  const rows = d
    .select()
    .from(schema.auditLog)
    .orderBy(sql`rowid ASC`)
    .all();
  return rows.map(drizzleRowToAuditEvent);
}

// ─── AI Task Queue ──────────────────────────────────────

export interface QueuedTask {
  id: string;
  taskType: string;
  priority: "immediate" | "batch";
  status: "pending" | "running" | "completed" | "failed";
  workerId?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export function enqueueTask(db: Database.Database, task: Omit<QueuedTask, "status" | "createdAt">): void {
  const d = getDrizzle(db);
  d.insert(schema.aiTaskQueue)
    .values({
      id: task.id,
      taskType: task.taskType,
      priority: task.priority,
      status: "pending",
      payload: task.payload,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function dequeueTasks(
  db: Database.Database,
  batchSize: number = 1,
  workerId?: string,
  taskType?: string,
): QueuedTask[] {
  // Atomic SELECT+UPDATE with RETURNING — keep raw SQL for complex subquery
  const where = taskType ? "AND task_type = ?" : "";
  const params: unknown[] = [batchSize];
  if (taskType) params.push(taskType);

  const now = new Date().toISOString();
  const wid = workerId ?? "default";

  const rows = db.prepare(
    `UPDATE ai_task_queue SET status = 'running', worker_id = '${wid}', started_at = ?
     WHERE id IN (
       SELECT id FROM ai_task_queue
       WHERE status = 'pending' ${where}
       ORDER BY CASE priority WHEN 'immediate' THEN 0 ELSE 1 END, created_at
       LIMIT ?
     )
     RETURNING *`,
  ).all(now, ...params) as Array<Record<string, unknown>>;

  return rows.map(rawRowToQueuedTask);
}

export function completeTask(db: Database.Database, taskId: string, result: Record<string, unknown>): void {
  const d = getDrizzle(db);
  d.update(schema.aiTaskQueue)
    .set({
      status: "completed",
      result,
      completedAt: new Date().toISOString(),
    })
    .where(eq(schema.aiTaskQueue.id, taskId))
    .run();
}

export function failTask(db: Database.Database, taskId: string, error: string): void {
  const d = getDrizzle(db);
  d.update(schema.aiTaskQueue)
    .set({
      status: "failed",
      error,
      completedAt: new Date().toISOString(),
    })
    .where(eq(schema.aiTaskQueue.id, taskId))
    .run();
}

export function getPendingTaskCount(db: Database.Database): number {
  const d = getDrizzle(db);
  const row = d
    .select({ count: count() })
    .from(schema.aiTaskQueue)
    .where(eq(schema.aiTaskQueue.status, "pending"))
    .get();
  return row?.count ?? 0;
}

/** 2분 이상 running 상태인 태스크를 pending으로 되돌림 (worker 크래시/재시작 복구) */
export function reclaimStaleTasks(db: Database.Database, staleMinutes: number = 2): number {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  const d = getDrizzle(db);
  const result = d
    .update(schema.aiTaskQueue)
    .set({
      status: "pending",
      workerId: null,
      startedAt: null,
    })
    .where(
      and(
        eq(schema.aiTaskQueue.status, "running"),
        lt(schema.aiTaskQueue.startedAt, cutoff),
      ),
    )
    .run();
  return result.changes;
}

// ─── FTS5 (BM25 search for Level 0) — raw SQL ───────────

export interface FTSRecord {
  chunkId: string;
  fileId: string;
  filePath: string;
  sectionPath: string;
  content: string;
  docType: string;
  tokenCount: number;
}

export interface FTSResult extends FTSRecord {
  rank: number; // BM25 rank (lower = more relevant)
}

export function upsertFTS(db: Database.Database, records: FTSRecord[]): void {
  const stmt = db.prepare(
    `INSERT INTO chunks_fts (chunk_id, file_id, file_path, section_path, content, doc_type, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of records) {
    stmt.run(r.chunkId, r.fileId, r.filePath, r.sectionPath, r.content, r.docType, r.tokenCount);
  }
}

export function deleteFTSByFileId(db: Database.Database, fileId: string): void {
  db.prepare("DELETE FROM chunks_fts WHERE file_id = ?").run(fileId);
}

export function searchBM25(
  db: Database.Database,
  query: string,
  limit: number = 50,
): FTSResult[] {
  const rows = db
    .prepare(
      `SELECT chunk_id, file_id, file_path, section_path, content, doc_type, token_count,
              rank
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(sanitizeFTSQuery(query), limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    chunkId: r.chunk_id as string,
    fileId: r.file_id as string,
    filePath: r.file_path as string,
    sectionPath: r.section_path as string,
    content: r.content as string,
    docType: r.doc_type as string,
    tokenCount: r.token_count as number,
    rank: r.rank as number,
  }));
}

/** FTS5 쿼리에서 특수문자 제거, 2글자 이상 토큰만 유지 */
function sanitizeFTSQuery(query: string): string {
  const tokens = query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return '""';
  return tokens.join(" OR ");
}

// ─── Transaction Helper ──────────────────────────────────

export function withinTransaction<T>(
  db: Database.Database,
  fn: () => T,
): T {
  return db.transaction(fn)();
}

// ─── Row Mapping (Drizzle select results → domain types) ─

function drizzleRowToFileRecord(row: typeof schema.files.$inferSelect): FileRecord {
  return {
    id: row.id,
    path: row.path,
    title: row.title ?? null,
    docType: row.docType ?? "unknown",
    frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
    checksum: row.checksum ?? "",
    totalTokens: row.totalTokens ?? 0,
    completenessScore: row.completenessScore ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    indexedAt: row.indexedAt,
  };
}

function drizzleRowToChunkRecord(row: typeof schema.chunks.$inferSelect): ChunkRecord {
  return {
    id: row.id,
    fileId: row.fileId,
    sectionPath: row.sectionPath ?? "",
    content: row.content,
    tokenCount: row.tokenCount ?? 0,
    headingLevel: row.headingLevel ?? 0,
    chunkType: (row.chunkType as ChunkRecord["chunkType"]) ?? "prose",
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

function drizzleRowToRelation(row: typeof schema.relations.$inferSelect): Relation {
  return {
    id: row.id,
    sourceChunkId: row.sourceChunkId,
    targetChunkId: row.targetChunkId,
    relationType: row.relationType as Relation["relationType"],
    confidence: row.confidence ?? 1.0,
    extractionMethod: row.extractionMethod as Relation["extractionMethod"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

function drizzleRowToConflict(row: typeof schema.conflicts.$inferSelect): Conflict {
  return {
    id: row.id,
    chunkAId: row.chunkAId,
    chunkBId: row.chunkBId,
    severity: row.severity as Conflict["severity"],
    description: row.description ?? "",
    status: row.status as Conflict["status"],
    resolvedBy: row.resolvedBy ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
    resolutionNote: row.resolutionNote ?? undefined,
    detectedAt: row.detectedAt,
  };
}

function drizzleRowToAuditEvent(row: typeof schema.auditLog.$inferSelect): AuditEvent {
  return {
    id: row.id,
    eventType: row.eventType as AuditEvent["eventType"],
    timestamp: row.timestamp,
    actor: row.actor ?? "unknown",
    targetFile: row.targetFile ?? undefined,
    targetChunkId: row.targetChunkId ?? undefined,
    details: (row.details as Record<string, unknown>) ?? {},
    rationale: row.rationale ?? undefined,
    basedOn: row.basedOn as string[] | undefined ?? undefined,
    previousHash: row.previousHash ?? "",
    hash: row.hash,
  };
}

// Raw SQL row mapping — used by getAuditEvents (dynamic filter) and dequeueTasks
function rawRowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row.id as string,
    eventType: row.event_type as AuditEvent["eventType"],
    timestamp: row.timestamp as string,
    actor: (row.actor as string) ?? "unknown",
    targetFile: row.target_file as string | undefined,
    targetChunkId: row.target_chunk_id as string | undefined,
    details: parseJsonField(row.details),
    rationale: row.rationale as string | undefined,
    basedOn: row.based_on ? (JSON.parse(row.based_on as string) as string[]) : undefined,
    previousHash: row.previous_hash as string,
    hash: row.hash as string,
  };
}

function rawRowToQueuedTask(row: Record<string, unknown>): QueuedTask {
  return {
    id: row.id as string,
    taskType: row.task_type as string,
    priority: row.priority as QueuedTask["priority"],
    status: row.status as QueuedTask["status"],
    workerId: row.worker_id as string | undefined,
    payload: parseJsonField(row.payload),
    result: row.result ? parseJsonField(row.result) : undefined,
    error: row.error as string | undefined,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
  };
}

function parseJsonField(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown>) ?? {};
}
