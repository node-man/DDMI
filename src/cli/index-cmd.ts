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

    // 2. AI 파일 단위 관계 추출 (Level 2)
    let aiRelCount = 0;
    if (aiProvider && indexed > 0) {
      console.log(`  AI relation extraction: analyzing ${allFileIds.size} files...`);
      const { insertRelations } = await import("../storage/sqlite.js");
      const now = new Date().toISOString();
      const allRelations: Relation[] = [];

      // 파일 목록을 문자열로 준비
      const fileList = [...allFileIds.entries()]
        .map(([path]) => `- ${path}`)
        .join("\n");

      for (const [filePath, fileId] of allFileIds) {
        // 파일의 청크를 가져옴
        const chunks = getChunksByFileId(db, fileId);
        if (chunks.length === 0) continue;

        // 첫 2개 청크의 내용 (파일의 주제 파악용)
        const fileContent = chunks.slice(0, 2).map(c => c.content).join("\n").slice(0, 600);

        const prompt = `You are analyzing document relationships in a project.

This document: ${filePath}
Content summary:
${fileContent}

Other files in the project:
${fileList}

Which files are related to "${filePath}" and how?
For each related file, specify the relationship type:
- references: this document mentions or cites the other
- depends_on: this document requires the other to be correct
- derived_from: this document was created based on the other
- supersedes: this document replaces or updates the other

Rules:
- Only list genuinely related files (not every file)
- Maximum 5 relations per file
- Do NOT include the file itself
- Confidence 0.5-1.0

Respond with JSON array:
[{"target": "path/to/file.md", "relationType": "depends_on", "confidence": 0.8}]
If no relations found, respond with: []`;

        try {
          let raw: unknown;
          try {
            raw = await aiProvider.chatJSON<unknown>(prompt);
          } catch {
            continue; // JSON 파싱 실패 → skip
          }

          const results = Array.isArray(raw) ? raw : [raw];
          let fileRelCount = 0;

          for (const r of results) {
            if (!r || typeof r !== "object") continue;
            const rObj = r as Record<string, unknown>;
            if (!rObj.target || !rObj.relationType) continue;
            const targetFileId = allFileIds.get(rObj.target as string);
            if (!targetFileId || targetFileId === fileId) continue;

            const validTypes = ["references", "depends_on", "derived_from", "supersedes", "contradicts"];
            if (!validTypes.includes(rObj.relationType as string)) continue;

            // source 파일의 첫 청크 → target 파일의 첫 청크 관계
            const targetChunks = getChunksByFileId(db, targetFileId);
            if (targetChunks.length === 0) continue;

            allRelations.push({
              id: `ai-${fileId.slice(0, 6)}-${targetFileId.slice(0, 6)}-${randomUUID().slice(0, 4)}`,
              sourceChunkId: chunks[0].id,
              targetChunkId: targetChunks[0].id,
              relationType: rObj.relationType as Relation["relationType"],
              confidence: typeof rObj.confidence === "number" ? rObj.confidence : 0.7,
              extractionMethod: "ai" as const,
              metadata: { source: filePath, target: rObj.target as string },
              createdAt: now,
            });
            fileRelCount++;
          }

          console.log(`    ${filePath} → ${fileRelCount} relations`);
        } catch {
          // 파일 분석 실패 → skip
        }
      }

      if (allRelations.length > 0) {
        insertRelations(db, allRelations);
        aiRelCount = allRelations.length;
        console.log(`  AI extracted ${aiRelCount} relations`);
      }
    }

    // 3. 임베딩 유사도 후보 → 충돌 감지 (Level 1+2)
    const pairs = await relationEngine.findSimilarPairs(changedChunkIds);

    // 충돌 감지
    let conflictCount = 0;
    if (pairs.length > 0) {
      const pairsWithContent = pairs.map((p) => {
        const chunkA = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.a) as { content: string } | undefined;
        const chunkB = db.prepare("SELECT content FROM chunks WHERE id = ?").get(p.b) as { content: string } | undefined;
        return { aId: p.a, aContent: chunkA?.content ?? "", bId: p.b, bContent: chunkB?.content ?? "" };
      });

      if (aiProvider) {
        // --provider 지정됨: 1쌍씩 즉시 LLM 분석 (Level 2)
        let aiErrors = 0;
        for (const pair of pairsWithContent) {
          try {
            const conflicts = await relationEngine.detectConflictsAI([pair]);
            conflictCount += conflicts.length;
          } catch (err) {
            aiErrors++;
            console.log(`  AI error (${pair.aId} vs ${pair.bId}): ${(err as Error).message.slice(0, 60)}`);
          }
        }
        if (aiErrors > 0) {
          console.log(`  ${aiErrors}/${pairsWithContent.length} pairs failed AI analysis`);
        }
      } else {
        // provider 없음: 쌍 1개 = 태스크 1개 (serve의 worker가 순차 처리)
        for (const pair of pairsWithContent) {
          enqueueTask(db, {
            id: randomUUID().slice(0, 16),
            taskType: "conflict_detection",
            priority: "batch",
            payload: pair,
          });
        }
      }
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

    // 4. AI doc_classification — docType이 "unknown"인 파일 자동 분류
    if (aiProvider) {
      const unknownFiles = db.prepare(
        "SELECT id, path FROM files WHERE doc_type = 'unknown'"
      ).all() as Array<{ id: string; path: string }>;

      if (unknownFiles.length > 0) {
        console.log(`  AI doc classification: ${unknownFiles.length} unknown files...`);
        let classified = 0;

        for (const file of unknownFiles) {
          try {
            const firstChunk = getChunksByFileId(db, file.id);
            if (firstChunk.length === 0) continue;

            const prompt = `Classify this document into ONE type: spec, decision, meeting, research, sprint, task, agent, guide, config, changelog, readme, plan, retrospective.

Document path: ${file.path}
Content (first 500 chars):
${firstChunk[0].content.slice(0, 500)}

Respond with JSON: {"docType": "one_of_the_types"}`;

            const result = await aiProvider.chatJSON<{ docType: string }>(prompt);
            const validTypes = [
              "spec", "decision", "meeting", "research", "sprint", "task",
              "agent", "guide", "config", "changelog", "readme", "plan", "retrospective",
            ];

            if (validTypes.includes(result.docType)) {
              db.prepare("UPDATE files SET doc_type = ? WHERE id = ?").run(result.docType, file.id);
              console.log(`    ${file.path} → ${result.docType}`);
              classified++;
            }
          } catch {
            // 분류 실패 시 "unknown" 유지
          }
        }

        if (classified > 0) {
          console.log(`  Classified ${classified}/${unknownFiles.length} files`);
        }
      }
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
