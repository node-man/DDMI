/**
 * SQLite Storage — better-sqlite3 래퍼
 *
 * .ddmi/index.db에 메타데이터, 청크, 피드백을 저장한다.
 * MVP-0 테이블: files, chunks, feedback_log
 * WAL 모드 활성화로 동시 읽기 성능 확보.
 */

import Database from "better-sqlite3";
import type {
  FileRecord,
  ChunkRecord,
  FeedbackRecord,
  FeedbackInput,
  ScoringWeights,
  Relation,
  Conflict,
} from "../types.js";

// ─── Schema ──────────────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS ai_task_queue (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'batch',
  status TEXT NOT NULL DEFAULT 'pending',
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

// ─── Init ────────────────────────────────────────────────

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

// ─── Files ───────────────────────────────────────────────

const UPSERT_FILE_SQL = `
  INSERT INTO files (id, path, title, doc_type, frontmatter, checksum, total_tokens, completeness_score, created_at, updated_at, indexed_at)
  VALUES (@id, @path, @title, @docType, @frontmatter, @checksum, @totalTokens, @completenessScore, @createdAt, @updatedAt, @indexedAt)
  ON CONFLICT(id) DO UPDATE SET
    title = @title, doc_type = @docType, frontmatter = @frontmatter,
    checksum = @checksum, total_tokens = @totalTokens, completeness_score = @completenessScore,
    updated_at = @updatedAt, indexed_at = @indexedAt
`;

export function upsertFile(db: Database.Database, file: FileRecord): void {
  db.prepare(UPSERT_FILE_SQL).run({
    id: file.id,
    path: file.path,
    title: file.title,
    docType: file.docType,
    frontmatter: JSON.stringify(file.frontmatter),
    checksum: file.checksum,
    totalTokens: file.totalTokens,
    completenessScore: file.completenessScore,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    indexedAt: file.indexedAt,
  });
}

export function getFileByPath(
  db: Database.Database,
  path: string,
): FileRecord | null {
  const row = db
    .prepare("SELECT * FROM files WHERE path = ?")
    .get(path) as Record<string, unknown> | undefined;
  return row ? rowToFileRecord(row) : null;
}

export function getFileByChecksum(
  db: Database.Database,
  path: string,
): string | null {
  const row = db
    .prepare("SELECT checksum FROM files WHERE path = ?")
    .get(path) as { checksum: string } | undefined;
  return row?.checksum ?? null;
}

export function getAllFiles(db: Database.Database): FileRecord[] {
  const rows = db
    .prepare("SELECT * FROM files ORDER BY path")
    .all() as Record<string, unknown>[];
  return rows.map(rowToFileRecord);
}

export function deleteFile(db: Database.Database, fileId: string): void {
  db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  // chunks cascade via ON DELETE CASCADE
}

// ─── Chunks ──────────────────────────────────────────────

const INSERT_CHUNK_SQL = `
  INSERT INTO chunks (id, file_id, section_path, content, token_count, heading_level, chunk_type, metadata, created_at)
  VALUES (@id, @fileId, @sectionPath, @content, @tokenCount, @headingLevel, @chunkType, @metadata, @createdAt)
`;

export function insertChunks(
  db: Database.Database,
  chunks: ChunkRecord[],
): void {
  const stmt = db.prepare(INSERT_CHUNK_SQL);
  for (const chunk of chunks) {
    stmt.run({
      id: chunk.id,
      fileId: chunk.fileId,
      sectionPath: chunk.sectionPath,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      headingLevel: chunk.headingLevel,
      chunkType: chunk.chunkType,
      metadata: JSON.stringify(chunk.metadata),
      createdAt: chunk.createdAt,
    });
  }
}

export function getChunksByFileId(
  db: Database.Database,
  fileId: string,
): ChunkRecord[] {
  const rows = db
    .prepare("SELECT * FROM chunks WHERE file_id = ? ORDER BY rowid")
    .all(fileId) as Record<string, unknown>[];
  return rows.map(rowToChunkRecord);
}

export function deleteChunksByFileId(
  db: Database.Database,
  fileId: string,
): void {
  db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
}

export function getChunkCount(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM chunks")
    .get() as { count: number };
  return row.count;
}

export function getFileCount(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM files")
    .get() as { count: number };
  return row.count;
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

  db.prepare(
    `INSERT INTO feedback_log
     (id, feedback_token, timestamp, intent, task_type, outcome,
      blocks_served, blocks_used, blocks_irrelevant, missing_context, scoring_weights)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    token,
    timestamp,
    meta.intent,
    meta.taskType,
    input.outcome,
    JSON.stringify(meta.blocksServed),
    JSON.stringify(input.blocksUsed ?? []),
    JSON.stringify(input.blocksIrrelevant ?? []),
    input.missingContext ?? null,
    JSON.stringify(meta.scoringWeights),
  );

  return record;
}

// ─── Relations ──────────────────────────────────────────

export function insertRelation(db: Database.Database, r: Relation): void {
  db.prepare(
    `INSERT OR REPLACE INTO relations (id, source_chunk_id, target_chunk_id, relation_type, confidence, extraction_method, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.sourceChunkId, r.targetChunkId, r.relationType, r.confidence, r.extractionMethod, JSON.stringify(r.metadata), r.createdAt);
}

export function insertRelations(db: Database.Database, relations: Relation[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO relations (id, source_chunk_id, target_chunk_id, relation_type, confidence, extraction_method, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of relations) {
    stmt.run(r.id, r.sourceChunkId, r.targetChunkId, r.relationType, r.confidence, r.extractionMethod, JSON.stringify(r.metadata), r.createdAt);
  }
}

export function getRelationsForChunk(db: Database.Database, chunkId: string): Relation[] {
  const rows = db.prepare(
    `SELECT * FROM relations WHERE source_chunk_id = ? OR target_chunk_id = ?`,
  ).all(chunkId, chunkId) as Array<Record<string, unknown>>;
  return rows.map(rowToRelation);
}

export function deleteRelationsByFileChunks(db: Database.Database, chunkIds: string[]): void {
  if (chunkIds.length === 0) return;
  const placeholders = chunkIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM relations WHERE source_chunk_id IN (${placeholders}) OR target_chunk_id IN (${placeholders})`).run(...chunkIds, ...chunkIds);
}

export function getRelationCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM relations").get() as { count: number };
  return row.count;
}

// ─── Conflicts ──────────────────────────────────────────

export function insertConflict(db: Database.Database, c: Conflict): void {
  db.prepare(
    `INSERT OR REPLACE INTO conflicts (id, chunk_a_id, chunk_b_id, severity, description, status, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.chunkAId, c.chunkBId, c.severity, c.description, c.status, c.detectedAt);
}

export function getOpenConflicts(db: Database.Database): Conflict[] {
  const rows = db.prepare(
    `SELECT * FROM conflicts WHERE status = 'open' ORDER BY detected_at DESC`,
  ).all() as Array<Record<string, unknown>>;
  return rows.map(rowToConflict);
}

export function resolveConflict(
  db: Database.Database,
  conflictId: string,
  resolvedBy: string,
  note: string,
): void {
  db.prepare(
    `UPDATE conflicts SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?`,
  ).run(resolvedBy, new Date().toISOString(), note, conflictId);
}

export function getConflictCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM conflicts WHERE status = 'open'").get() as { count: number };
  return row.count;
}

function rowToRelation(row: Record<string, unknown>): Relation {
  return {
    id: row.id as string,
    sourceChunkId: row.source_chunk_id as string,
    targetChunkId: row.target_chunk_id as string,
    relationType: row.relation_type as Relation["relationType"],
    confidence: row.confidence as number,
    extractionMethod: row.extraction_method as Relation["extractionMethod"],
    metadata: parseJsonField(row.metadata),
    createdAt: row.created_at as string,
  };
}

function rowToConflict(row: Record<string, unknown>): Conflict {
  return {
    id: row.id as string,
    chunkAId: row.chunk_a_id as string,
    chunkBId: row.chunk_b_id as string,
    severity: row.severity as Conflict["severity"],
    description: (row.description as string) ?? "",
    status: row.status as Conflict["status"],
    resolvedBy: row.resolved_by as string | undefined,
    resolvedAt: row.resolved_at as string | undefined,
    resolutionNote: row.resolution_note as string | undefined,
    detectedAt: row.detected_at as string,
  };
}

// ─── AI Task Queue ──────────────────────────────────────

export interface QueuedTask {
  id: string;
  taskType: string;
  priority: "immediate" | "batch";
  status: "pending" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export function enqueueTask(db: Database.Database, task: Omit<QueuedTask, "status" | "createdAt">): void {
  db.prepare(
    `INSERT INTO ai_task_queue (id, task_type, priority, status, payload, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(task.id, task.taskType, task.priority, JSON.stringify(task.payload), new Date().toISOString());
}

export function dequeueTasks(db: Database.Database, batchSize: number = 10, taskType?: string): QueuedTask[] {
  const where = taskType ? "AND task_type = ?" : "";
  const params: unknown[] = [batchSize];
  if (taskType) params.push(taskType);

  // immediate 먼저, 그 다음 batch, 생성 순
  const rows = db.prepare(
    `UPDATE ai_task_queue SET status = 'running', started_at = ?
     WHERE id IN (
       SELECT id FROM ai_task_queue
       WHERE status = 'pending' ${where}
       ORDER BY CASE priority WHEN 'immediate' THEN 0 ELSE 1 END, created_at
       LIMIT ?
     )
     RETURNING *`,
  ).all(new Date().toISOString(), ...params) as Array<Record<string, unknown>>;

  return rows.map(rowToQueuedTask);
}

export function completeTask(db: Database.Database, taskId: string, result: Record<string, unknown>): void {
  db.prepare(
    `UPDATE ai_task_queue SET status = 'completed', result = ?, completed_at = ? WHERE id = ?`,
  ).run(JSON.stringify(result), new Date().toISOString(), taskId);
}

export function failTask(db: Database.Database, taskId: string, error: string): void {
  db.prepare(
    `UPDATE ai_task_queue SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
  ).run(error, new Date().toISOString(), taskId);
}

export function getPendingTaskCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM ai_task_queue WHERE status = 'pending'").get() as { count: number };
  return row.count;
}

function rowToQueuedTask(row: Record<string, unknown>): QueuedTask {
  return {
    id: row.id as string,
    taskType: row.task_type as string,
    priority: row.priority as QueuedTask["priority"],
    status: row.status as QueuedTask["status"],
    payload: parseJsonField(row.payload),
    result: row.result ? parseJsonField(row.result) : undefined,
    error: row.error as string | undefined,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
  };
}

// ─── FTS5 (BM25 search for Level 0) ─────────────────────

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

// ─── Row Mapping ─────────────────────────────────────────

function rowToFileRecord(row: Record<string, unknown>): FileRecord {
  return {
    id: row.id as string,
    path: row.path as string,
    title: (row.title as string) ?? null,
    docType: (row.doc_type as string) ?? "unknown",
    frontmatter: parseJsonField(row.frontmatter),
    checksum: (row.checksum as string) ?? "",
    totalTokens: (row.total_tokens as number) ?? 0,
    completenessScore: (row.completeness_score as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    indexedAt: row.indexed_at as string,
  };
}

function rowToChunkRecord(row: Record<string, unknown>): ChunkRecord {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    sectionPath: (row.section_path as string) ?? "",
    content: row.content as string,
    tokenCount: (row.token_count as number) ?? 0,
    headingLevel: (row.heading_level as number) ?? 0,
    chunkType: (row.chunk_type as string as ChunkRecord["chunkType"]) ?? "prose",
    metadata: parseJsonField(row.metadata),
    createdAt: row.created_at as string,
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
