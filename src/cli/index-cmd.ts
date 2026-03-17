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
  getChunksByFileId,
} from "../storage/sqlite.js";
import {
  initVectorStore,
  upsertVectors,
  deleteByFileId,
} from "../storage/lance.js";
import { randomUUID } from "node:crypto";
import type { FileRecord, VectorRecord, ExplicitLink, Relation } from "../types.js";
import { createRelationEngine } from "../core/relations.js";
import { deleteRelationsByFileChunks, enqueueTask } from "../storage/sqlite.js";
import { loadConfig } from "../core/config.js";
import { createRouter } from "../ai/router.js";
import { initAILogger } from "../ai/logger.js";
import type { FileSummary, SimilarPair } from "../ai/batch.js";

const IGNORE_PATTERNS = ["node_modules", ".git", ".ddmi", "dist", ".test-tmp", "eval"];

export async function runIndex(
  projectRoot: string,
  options: { incremental?: boolean; provider?: string } = {},
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
  const changedFilePaths = new Set<string>(); // 이번 실행에서 변경된 파일
  const changedFileLinks: Array<{ fileId: string; links: ExplicitLink[] }> = [];
  const changedChunkIds: string[] = [];

  for (let i = 0; i < mdFiles.length; i++) {
    const filePath = mdFiles[i];
    const relPath = relative(projectRoot, filePath);

    try {
      const content = readFileSync(filePath, "utf-8");
      const checksum = computeChecksum(content);

      // 모든 파일의 fileId를 수집 (관계 추출에 필요 — skip된 파일도 링크 target이 될 수 있음)
      const fileIdForMap = generateFileId(relPath);
      allFileIds.set(relPath, fileIdForMap);

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
      changedFilePaths.add(relPath);
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
    // provider 지정 시 AI 충돌 감지까지 즉시 실행
    let aiProvider = null;
    if (options.provider) {
      initAILogger(ddmiDir);
      const config = loadConfig(projectRoot);
      config.ai.defaultProvider = options.provider;
      const router = await createRouter(config);
      aiProvider = router.getProvider();
      if (aiProvider) {
        console.log(`  AI provider: ${aiProvider.name}`);
      }
    }

    const relationEngine = createRelationEngine({
      dbPath, embedder, lance, aiProvider,
    });

    // 1. 명시적 링크 → references 관계 (Level 0)
    let relCount = 0;
    for (const { fileId, links } of changedFileLinks) {
      const rels = relationEngine.extractExplicitLinks(fileId, links, allFileIds);
      relCount += rels.length;
    }

    // 2. 임베딩 유사도 후보 (Level 1) — AI 통합 분석에서도 사용
    const pairs = await relationEngine.findSimilarPairs(changedChunkIds);

    // provider 없을 때: 충돌 감지 태스크를 큐에 등록 (serve의 worker가 순차 처리)
    if (!aiProvider && pairs.length > 0) {
      const pairsForQueue = pairs.map((p) => {
        const chunkA = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.a) as { content: string } | undefined;
        const chunkB = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.b) as { content: string } | undefined;
        return { aId: p.a, aContent: chunkA?.content ?? "", bId: p.b, bContent: chunkB?.content ?? "" };
      });
      for (const pair of pairsForQueue) {
        enqueueTask(db, {
          id: randomUUID().slice(0, 16),
          taskType: "conflict_detection",
          priority: "batch",
          payload: pair,
        });
      }
    }

    // ─── AI 배치 분석 (Level 2) — provider별 배치 크기로 분할 호출 ─────
    let aiRelCount = 0;
    let conflictCount = 0;
    if (aiProvider && indexed > 0) {
      const { insertRelations, insertConflict } = await import("../storage/sqlite.js");
      const { splitIntoBatches, buildBatchPrompt, buildCrossRelationPrompt } = await import("../ai/batch.js");
      const now = new Date().toISOString();

      // 파일 요약 준비
      const fileSummaries: FileSummary[] = [];
      for (const [path, fid] of allFileIds) {
        const chunks = getChunksByFileId(db, fid);
        const summary = chunks.length > 0 ? chunks[0].content.slice(0, 200) : "(empty)";
        const docType = db.prepare("SELECT doc_type FROM files WHERE id = ?").get(fid) as { doc_type: string } | undefined;
        fileSummaries.push({ path, fileId: fid, docType: docType?.doc_type ?? "unknown", summary });
      }

      // 유사 쌍 준비 (교차 관계용)
      const pairsWithContent: SimilarPair[] = pairs.map((p) => {
        const chunkA = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.a) as { content: string } | undefined;
        const chunkB = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.b) as { content: string } | undefined;
        return { aId: p.a, aContent: chunkA?.content ?? "", bId: p.b, bContent: chunkB?.content ?? "" };
      });

      // 배치 분할
      const providerName = aiProvider.name;
      const batches = splitIntoBatches(fileSummaries, pairsWithContent, providerName, changedFilePaths);
      console.log(`  AI analysis: ${allFileIds.size} files → ${batches.length} batches (${providerName})`);

      // 배치별 분석
      const validTypes = ["spec", "decision", "meeting", "research", "sprint", "task", "agent", "guide", "config", "changelog", "readme", "plan", "retrospective"];
      const validRelTypes = ["references", "depends_on", "derived_from", "supersedes", "contradicts"];
      let totalClassified = 0;

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const prompt = buildBatchPrompt(batch, allFileIds.size);

        try {
          let raw: unknown;
          try {
            raw = await aiProvider.chatJSON<unknown>(prompt);
          } catch (chatErr) {
            const msg = (chatErr as Error).message ?? "";
            if (msg.includes("No valid JSON")) {
              console.log(`  Batch ${bi + 1}/${batches.length}: no valid JSON, skipping`);
              continue;
            }
            throw chatErr;
          }

          if (!raw || typeof raw !== 'object') continue;

          const result = raw as {
            classifications?: Array<{path: string; docType: string}>;
            relations?: Array<{source: string; target: string; relationType: string; confidence?: number}>;
            conflicts?: Array<{pairIndex: number; severity: string; description: string}>;
          };

          // 분류 적용
          for (const c of result.classifications ?? []) {
            if (!c.path || !validTypes.includes(c.docType)) continue;
            const unknownFiles = db.prepare("SELECT id FROM files WHERE path = ? AND doc_type = 'unknown'").all(c.path) as Array<{id: string}>;
            for (const f of unknownFiles) {
              db.prepare("UPDATE files SET doc_type = ? WHERE id = ?").run(c.docType, f.id);
              totalClassified++;
            }
          }

          // 관계 저장
          const relations: Relation[] = [];
          for (const r of result.relations ?? []) {
            if (!r.source || !r.target || !validRelTypes.includes(r.relationType)) continue;
            const srcFileId = allFileIds.get(r.source);
            const tgtFileId = allFileIds.get(r.target);
            if (!srcFileId || !tgtFileId || srcFileId === tgtFileId) continue;

            const srcChunks = getChunksByFileId(db, srcFileId);
            const tgtChunks = getChunksByFileId(db, tgtFileId);
            if (srcChunks.length === 0 || tgtChunks.length === 0) continue;

            relations.push({
              id: `ai-${srcFileId.slice(0,6)}-${tgtFileId.slice(0,6)}-${randomUUID().slice(0,4)}`,
              sourceChunkId: srcChunks[0].id,
              targetChunkId: tgtChunks[0].id,
              relationType: r.relationType as Relation["relationType"],
              confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
              extractionMethod: "ai" as const,
              metadata: { source: r.source, target: r.target },
              createdAt: now,
            });
          }
          if (relations.length > 0) insertRelations(db, relations);
          aiRelCount += relations.length;

          console.log(`  Batch ${bi + 1}/${batches.length}: ${result.classifications?.length ?? 0} classified, ${relations.length} relations`);
        } catch (err) {
          console.log(`  Batch ${bi + 1}/${batches.length} failed: ${(err as Error).message.slice(0, 60)}`);
        }
      }

      // 교차 관계: 벡터 유사도로 추출된 쌍을 LLM에게 검증 요청
      if (pairsWithContent.length > 0) {
        console.log(`  Cross-batch: ${pairsWithContent.length} similar pairs...`);
        const crossPrompt = buildCrossRelationPrompt(pairsWithContent);
        try {
          let crossRaw: unknown;
          try {
            crossRaw = await aiProvider.chatJSON<unknown>(crossPrompt);
          } catch (chatErr) {
            const msg = (chatErr as Error).message ?? "";
            if (msg.includes("No valid JSON")) {
              console.log(`  Cross-batch: no valid JSON, skipping`);
              crossRaw = null;
            } else {
              throw chatErr;
            }
          }

          if (crossRaw && typeof crossRaw === 'object') {
            const crossResult = crossRaw as {
              relations?: Array<{pairIndex: number; relationType: string; confidence?: number}>;
              conflicts?: Array<{pairIndex: number; severity: string; description: string}>;
            };

            // 교차 관계 저장
            const validRelTypes = ["references", "depends_on", "derived_from", "supersedes", "contradicts"];
            const crossRelations: Relation[] = [];
            for (const r of crossResult.relations ?? []) {
              if (r.pairIndex < 0 || r.pairIndex >= pairsWithContent.length) continue;
              if (!validRelTypes.includes(r.relationType)) continue;
              const pair = pairsWithContent[r.pairIndex];
              crossRelations.push({
                id: `cross-${randomUUID().slice(0, 8)}`,
                sourceChunkId: pair.aId,
                targetChunkId: pair.bId,
                relationType: r.relationType as Relation["relationType"],
                confidence: typeof r.confidence === 'number' ? r.confidence : 0.6,
                extractionMethod: "ai" as const,
                metadata: { source: "cross-batch", pairIndex: r.pairIndex },
                createdAt: now,
              });
            }
            if (crossRelations.length > 0) {
              insertRelations(db, crossRelations);
              aiRelCount += crossRelations.length;
            }

            // 교차 충돌 저장
            for (const c of crossResult.conflicts ?? []) {
              if (c.pairIndex < 0 || c.pairIndex >= pairsWithContent.length) continue;
              const pair = pairsWithContent[c.pairIndex];
              insertConflict(db, {
                id: randomUUID().slice(0, 16),
                chunkAId: pair.aId,
                chunkBId: pair.bId,
                severity: (["low", "medium", "high"].includes(c.severity) ? c.severity : "medium") as any,
                description: c.description || "Conflict detected",
                status: "open",
                detectedAt: now,
              });
              conflictCount++;
            }
            console.log(`  Cross-batch result: ${crossRelations.length} relations, ${conflictCount} conflicts`);
          }
        } catch (err) {
          console.log(`  Cross-batch failed: ${(err as Error).message.slice(0, 60)}`);
        }
      }

      console.log(`  AI total: ${totalClassified} classified, ${aiRelCount} relations, ${conflictCount} conflicts (${batches.length} batch calls)`);

    }

    if (relCount > 0 || aiRelCount > 0 || pairs.length > 0) {
      const action = aiProvider
        ? `${conflictCount} conflicts detected`
        : `${pairs.length} tasks queued`;
      console.log(`  Relations: ${relCount} explicit, ${aiRelCount} AI, ${pairs.length} similar pairs → ${action}`);
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

// ─── Exported for testing ────────────────────────────────

const MAX_FILE_SUMMARIES = 50;

export function capFileSummaries(
  fileSummaries: string[],
  filePaths: string[],
  changedFilePaths: Set<string>,
): string[] {
  const changedSummaries = fileSummaries.filter((_, i) => changedFilePaths.has(filePaths[i]));
  const unchangedSummaries = fileSummaries.filter((_, i) => !changedFilePaths.has(filePaths[i]));
  const prioritized = [...changedSummaries, ...unchangedSummaries];
  const capped = prioritized.slice(0, MAX_FILE_SUMMARIES);
  if (fileSummaries.length > MAX_FILE_SUMMARIES) {
    capped.push(`... and ${fileSummaries.length - MAX_FILE_SUMMARIES} more files (omitted for context limit)`);
  }
  return capped;
}

// ─── Helpers ─────────────────────────────────────────────

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
