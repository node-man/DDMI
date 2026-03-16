/**
 * Drizzle ORM Schema — ddmi 전체 테이블 정의
 *
 * 이 파일이 데이터베이스의 단일 진실원(Single Source of Truth).
 * 컬럼 변경 → TypeScript 컴파일 에러로 즉시 감지.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Files ──────────────────────────────────────────────

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  title: text("title"),
  docType: text("doc_type"),
  frontmatter: text("frontmatter", { mode: "json" }).$type<Record<string, unknown>>(),
  checksum: text("checksum"),
  totalTokens: integer("total_tokens"),
  completenessScore: real("completeness_score").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  indexedAt: text("indexed_at").notNull(),
});

// ─── Chunks ─────────────────────────────────────────────

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  sectionPath: text("section_path"),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  headingLevel: integer("heading_level"),
  chunkType: text("chunk_type").default("prose"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull(),
});

// ─── Feedback ───────────────────────────────────────────

export const feedbackLog = sqliteTable("feedback_log", {
  id: text("id").primaryKey(),
  feedbackToken: text("feedback_token").notNull(),
  timestamp: text("timestamp").notNull(),
  intent: text("intent"),
  taskType: text("task_type"),
  outcome: text("outcome"),
  blocksServed: text("blocks_served", { mode: "json" }).$type<string[]>(),
  blocksUsed: text("blocks_used", { mode: "json" }).$type<string[]>(),
  blocksIrrelevant: text("blocks_irrelevant", { mode: "json" }).$type<string[]>(),
  missingContext: text("missing_context"),
  scoringWeights: text("scoring_weights", { mode: "json" }).$type<Record<string, number>>(),
});

// ─── Relations ──────────────────────────────────────────

export const relations = sqliteTable("relations", {
  id: text("id").primaryKey(),
  sourceChunkId: text("source_chunk_id").notNull(),
  targetChunkId: text("target_chunk_id").notNull(),
  relationType: text("relation_type").notNull(),
  confidence: real("confidence").default(1.0),
  extractionMethod: text("extraction_method"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull(),
});

// ─── Conflicts ──────────────────────────────────────────

export const conflicts = sqliteTable("conflicts", {
  id: text("id").primaryKey(),
  chunkAId: text("chunk_a_id").notNull(),
  chunkBId: text("chunk_b_id").notNull(),
  severity: text("severity").notNull(),
  description: text("description"),
  status: text("status").default("open"),
  resolvedBy: text("resolved_by"),
  resolvedAt: text("resolved_at"),
  resolutionNote: text("resolution_note"),
  detectedAt: text("detected_at").notNull(),
});

// ─── Audit Log ──────────────────────────────────────────

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  timestamp: text("timestamp").notNull(),
  actor: text("actor"),
  targetFile: text("target_file"),
  targetChunkId: text("target_chunk_id"),
  details: text("details", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  rationale: text("rationale"),
  basedOn: text("based_on", { mode: "json" }).$type<string[]>(),
  previousHash: text("previous_hash"),
  hash: text("hash").notNull(),
});

// ─── AI Task Queue ──────────────────────────────────────

export const aiTaskQueue = sqliteTable("ai_task_queue", {
  id: text("id").primaryKey(),
  taskType: text("task_type").notNull(),
  priority: text("priority").notNull().default("batch"),
  status: text("status").notNull().default("pending"),
  workerId: text("worker_id"),
  payload: text("payload", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});
