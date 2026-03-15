/**
 * LanceDB Storage — 벡터 임베딩 래퍼
 *
 * .ddmi/vectors.lance에 청크 임베딩을 저장한다.
 * Section-level 임베딩만 (MVP-0).
 */

import * as lancedb from "@lancedb/lancedb";
import type { VectorRecord, SearchResult } from "../types.js";

const TABLE_NAME = "chunk_embeddings";

export interface LanceConnection {
  db: lancedb.Connection;
  table: lancedb.Table | null;
}

export async function initVectorStore(
  dbPath: string,
): Promise<LanceConnection> {
  const db = await lancedb.connect(dbPath);
  let table: lancedb.Table | null = null;

  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
  }

  return { db, table };
}

export async function upsertVectors(
  conn: LanceConnection,
  vectors: VectorRecord[],
): Promise<void> {
  if (vectors.length === 0) return;

  const data = vectors.map((v) => ({
    id: v.id,
    vector: v.vector,
    file_id: v.fileId,
    file_path: v.filePath,
    section_path: v.sectionPath,
    content: v.content,
    doc_type: v.docType,
    date: v.date,
    token_count: v.tokenCount,
  }));

  if (!conn.table) {
    conn.table = await conn.db.createTable(TABLE_NAME, data);
  } else {
    await conn.table.add(data);
  }
}

export async function searchSimilar(
  conn: LanceConnection,
  queryVec: number[],
  limit: number = 20,
): Promise<SearchResult[]> {
  if (!conn.table) return [];

  const results = await conn.table
    .search(queryVec)
    .limit(limit)
    .toArray();

  return results.map((r) => ({
    id: r.id as string,
    vector: r.vector as number[],
    fileId: r.file_id as string,
    filePath: r.file_path as string,
    sectionPath: r.section_path as string,
    content: r.content as string,
    docType: r.doc_type as string,
    date: r.date as string,
    tokenCount: r.token_count as number,
    distance: (r._distance as number) ?? 0,
    similarity: 1 - ((r._distance as number) ?? 0),
  }));
}

export async function deleteByFileId(
  conn: LanceConnection,
  fileId: string,
): Promise<void> {
  if (!conn.table) return;
  await conn.table.delete(`file_id = '${fileId}'`);
}

export async function dropAll(conn: LanceConnection): Promise<void> {
  const tables = await conn.db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    await conn.db.dropTable(TABLE_NAME);
    conn.table = null;
  }
}

export async function vectorCount(conn: LanceConnection): Promise<number> {
  if (!conn.table) return 0;
  return await conn.table.countRows();
}
