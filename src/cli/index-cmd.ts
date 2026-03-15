/**
 * ddmi index — MD 파일 인덱싱
 *
 * 프로젝트의 .md 파일을 스캔 → 파싱 → 청킹 → 임베딩 → SQLite + LanceDB 저장
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMarkdown } from "../core/parser.js";
import { chunkDocument, generateFileId, computeChecksum } from "../core/chunker.js";
import { createEmbedder } from "../core/embedder.js";
import {
  initDatabase,
  upsertFile,
  insertChunks,
  deleteChunksByFileId,
  getFileByChecksum,
  withinTransaction,
  getFileCount,
  getChunkCount,
} from "../storage/sqlite.js";
import {
  initVectorStore,
  upsertVectors,
  deleteByFileId,
} from "../storage/lance.js";
import type { FileRecord, VectorRecord } from "../types.js";

const IGNORE_PATTERNS = ["node_modules", ".git", ".ddmi", "dist", ".test-tmp"];

export async function runIndex(
  projectRoot: string,
  options: { incremental?: boolean } = {},
): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const lancePath = join(ddmiDir, "vectors.lance");

  // Find all .md files
  const mdFiles = findMdFiles(projectRoot, projectRoot);
  console.log(`Found ${mdFiles.length} MD files`);

  if (mdFiles.length === 0) {
    console.log("No MD files found. Nothing to index.");
    return;
  }

  // Initialize storage
  const db = initDatabase(dbPath);
  const lance = await initVectorStore(lancePath);

  // Initialize embedder
  console.log("Loading embedding model...");
  const embedder = await createEmbedder();
  console.log(`Model loaded (${embedder.dimensions()} dimensions)`);

  const startTime = Date.now();
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < mdFiles.length; i++) {
    const filePath = mdFiles[i];
    const relPath = relative(projectRoot, filePath);

    try {
      const content = readFileSync(filePath, "utf-8");
      const checksum = computeChecksum(content);

      // Incremental: skip unchanged files
      if (options.incremental) {
        const existing = getFileByChecksum(db, relPath);
        if (existing === checksum) {
          skipped++;
          continue;
        }
      }

      process.stdout.write(
        `  [${i + 1}/${mdFiles.length}] ${relPath}...`,
      );

      // Parse
      const parsed = parseMarkdown(content, relPath);

      // Chunk
      const chunks = chunkDocument(parsed);

      if (chunks.length === 0) {
        console.log(" (empty, skipped)");
        skipped++;
        continue;
      }

      // Embed
      const texts = chunks.map(
        (c) => `${c.sectionPath}\n${c.content}`,
      );
      const vectors = await embedder.embed(texts);

      // Store (atomic: SQLite + LanceDB)
      const fileId = generateFileId(relPath);
      const now = new Date().toISOString();
      const fileStats = statSync(filePath);

      const fileRecord: FileRecord = {
        id: fileId,
        path: relPath,
        title: parsed.title,
        docType: parsed.docType,
        frontmatter: parsed.frontmatter,
        checksum,
        totalTokens: chunks.reduce((s, c) => s + c.tokenCount, 0),
        completenessScore: parsed.checklistScore,
        createdAt: fileStats.birthtime.toISOString(),
        updatedAt: fileStats.mtime.toISOString(),
        indexedAt: now,
      };

      const vectorRecords: VectorRecord[] = chunks.map((chunk, j) => ({
        id: chunk.id,
        vector: vectors[j],
        fileId,
        filePath: relPath,
        sectionPath: chunk.sectionPath,
        content: chunk.content,
        docType: parsed.docType,
        date: String(parsed.frontmatter.date ?? now.slice(0, 10)),
        tokenCount: chunk.tokenCount,
      }));

      withinTransaction(db, () => {
        deleteChunksByFileId(db, fileId);
        upsertFile(db, fileRecord);
        insertChunks(db, chunks);
      });

      await deleteByFileId(lance, fileId);
      await upsertVectors(lance, vectorRecords);

      indexed++;
      console.log(` ${chunks.length} chunks`);
    } catch (err) {
      errors++;
      console.log(` ERROR: ${(err as Error).message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  db.close();

  console.log(
    `\nDone in ${elapsed}s: ${indexed} indexed, ${skipped} skipped, ${errors} errors`,
  );
}

function findMdFiles(dir: string, projectRoot: string): string[] {
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_PATTERNS.some((p) => entry.name === p)) continue;
        results.push(...findMdFiles(fullPath, projectRoot));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Permission denied or similar — skip
  }

  return results;
}
