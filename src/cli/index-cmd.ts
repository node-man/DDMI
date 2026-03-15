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
  upsertFTS,
  deleteFTSByFileId,
} from "../storage/sqlite.js";
import {
  initVectorStore,
  upsertVectors,
  deleteByFileId,
} from "../storage/lance.js";
import { randomUUID } from "node:crypto";
import type { FileRecord, VectorRecord, ExplicitLink } from "../types.js";
import { createRelationEngine } from "../core/relations.js";
import { deleteRelationsByFileChunks, enqueueTask } from "../storage/sqlite.js";

const IGNORE_PATTERNS = ["node_modules", ".git", ".ddmi", "dist", ".test-tmp", "eval"];

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

  // 관계 추출용 데이터 수집
  const allFileIds = new Map<string, string>(); // path → fileId
  const changedFileLinks: Array<{ fileId: string; links: ExplicitLink[] }> = [];
  const changedChunkIds: string[] = [];

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
      allFileIds.set(relPath, fileId);
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

      // Atomic update: LanceDB first (more likely to fail), then SQLite
      await deleteByFileId(lance, fileId);
      try {
        await upsertVectors(lance, vectorRecords);
      } catch (lanceErr) {
        // LanceDB failed after delete — file will be re-indexed next run
        console.log(` LANCE ERROR: ${(lanceErr as Error).message}`);
        errors++;
        continue;
      }

      // 기존 청크 ID 수집 (관계 삭제용)
      const oldChunkIds = db.prepare("SELECT id FROM chunks WHERE file_id = ?")
        .all(fileId)
        .map((r: any) => r.id as string);

      withinTransaction(db, () => {
        if (oldChunkIds.length > 0) {
          deleteRelationsByFileChunks(db, oldChunkIds);
        }
        deleteChunksByFileId(db, fileId);
        deleteFTSByFileId(db, fileId);
        upsertFile(db, fileRecord);
        insertChunks(db, chunks);
        upsertFTS(
          db,
          chunks.map((c) => ({
            chunkId: c.id,
            fileId,
            filePath: relPath,
            sectionPath: c.sectionPath,
            content: c.content,
            docType: parsed.docType,
            tokenCount: c.tokenCount,
          })),
        );
      });

      indexed++;
      console.log(` ${chunks.length} chunks`);

      // 관계 추출용 데이터 수집
      if (parsed.links.length > 0) {
        changedFileLinks.push({ fileId, links: parsed.links });
      }
      changedChunkIds.push(...chunks.map((c) => c.id));
    } catch (err) {
      errors++;
      console.log(` ERROR: ${(err as Error).message}`);
    }
  }

  // ─── 관계 추출 (인덱싱 후) ─────────────────────────────
  if (indexed > 0) {
    const relationEngine = createRelationEngine({
      dbPath,
      embedder,
      lance,
      aiProvider: null, // LLM 충돌 감지는 ddmi serve에서 별도 실행
    });

    // 1. 명시적 링크 → references 관계 (Level 0)
    let relCount = 0;
    for (const { fileId, links } of changedFileLinks) {
      const rels = relationEngine.extractExplicitLinks(fileId, links, allFileIds);
      relCount += rels.length;
    }

    // 2. 임베딩 유사도 후보 → 큐에 추가 (LLM 충돌 감지는 serve worker가 처리)
    const pairs = await relationEngine.findSimilarPairs(changedChunkIds);

    if (pairs.length > 0) {
      // 청크 내용을 함께 큐에 저장 (worker가 다시 조회할 필요 없도록)
      const pairsWithContent = pairs.map((p) => {
        const chunkA = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.a) as { content: string } | undefined;
        const chunkB = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.b) as { content: string } | undefined;
        return { aId: p.a, aContent: chunkA?.content ?? "", bId: p.b, bContent: chunkB?.content ?? "", similarity: p.similarity };
      });

      // 10쌍씩 배치로 큐에 추가
      for (let i = 0; i < pairsWithContent.length; i += 10) {
        const batch = pairsWithContent.slice(i, i + 10);
        enqueueTask(db, {
          id: randomUUID().slice(0, 16),
          taskType: "conflict_detection",
          priority: "batch",
          payload: { pairs: batch },
        });
      }
    }

    if (relCount > 0 || pairs.length > 0) {
      console.log(`  Relations: ${relCount} explicit, ${pairs.length} similar pairs → ${Math.ceil(pairs.length / 10)} tasks queued`);
    }

    const stats = relationEngine.stats();
    if (stats.relations > 0 || stats.openConflicts > 0) {
      console.log(`  Total: ${stats.relations} relations, ${stats.openConflicts} open conflicts`);
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
