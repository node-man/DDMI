/**
 * Relation Engine — ddmi의 경쟁 차별화 핵심
 *
 * 청크 간 관계를 추출하고 충돌을 감지한다.
 * 3단계: 명시적 링크 (Level 0) → 임베딩 유사도 (Level 1) → LLM 분석 (Level 2)
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Relation,
  Conflict,
  ExplicitLink,
  AIProvider,
} from "../types.js";
import {
  initDatabase,
  getChunksByFileId,
  insertRelations,
  insertConflict,
  getRelationsForChunk,
  getOpenConflicts,
  resolveConflict as resolveConflictDB,
  deleteRelationsByFileChunks,
  getRelationCount,
  getConflictCount,
} from "../storage/sqlite.js";
import {
  searchSimilar,
  type LanceConnection,
} from "../storage/lance.js";
import type { Embedder } from "./embedder.js";

// ─── Public API ──────────────────────────────────────────

export interface RelationEngineDeps {
  dbPath: string;
  embedder: Embedder | null;
  lance: LanceConnection | null;
  aiProvider: AIProvider | null;
  similarityThreshold?: number; // default 0.85 (Level 1 후보 필터용)
}

export interface RelationEngine {
  /** 파일의 명시적 링크에서 references 관계 추출 (Level 0) */
  extractExplicitLinks(
    fileId: string,
    links: ExplicitLink[],
    allFileIds: Map<string, string>,
  ): Relation[];

  /** 변경된 청크와 기존 청크 간 유사도 후보 추출 (Level 1) */
  findSimilarPairs(
    changedChunkIds: string[],
  ): Promise<Array<{ a: string; b: string; similarity: number }>>;

  /** LLM으로 청크 쌍의 충돌 감지 (Level 2) */
  detectConflictsAI(
    pairs: Array<{ aId: string; aContent: string; bId: string; bContent: string }>,
  ): Promise<Conflict[]>;

  /** 특정 청크의 관계 조회 */
  getRelations(chunkId: string): Relation[];

  /** 미해결 충돌 목록 */
  getConflicts(): Conflict[];

  /** 충돌 해결 */
  resolve(conflictId: string, resolvedBy: string, note: string): void;

  /** 통계 */
  stats(): { relations: number; openConflicts: number };
}

export function createRelationEngine(deps: RelationEngineDeps): RelationEngine {
  const threshold = deps.similarityThreshold ?? 0.85;
  const db = initDatabase(deps.dbPath);

  return {
    extractExplicitLinks(
      fileId: string,
      links: ExplicitLink[],
      allFileIds: Map<string, string>, // path → fileId
    ): Relation[] {
      const sourceChunks = getChunksByFileId(db, fileId);
      if (sourceChunks.length === 0 || links.length === 0) return [];

      const relations: Relation[] = [];
      const now = new Date().toISOString();

      for (const link of links) {
        // 링크 target → 파일 경로 resolve
        const targetFileId = resolveLink(link.target, allFileIds);
        if (!targetFileId || targetFileId === fileId) continue;

        const targetChunks = getChunksByFileId(db, targetFileId);
        if (targetChunks.length === 0) continue;

        // source section에서 해당 링크를 포함하는 청크 찾기
        const sourceChunk = sourceChunks.find(
          (c) => c.sectionPath === link.sourceSection || c.content.includes(link.text),
        ) ?? sourceChunks[0];

        // target 파일의 첫 청크와 references 관계 생성
        relations.push({
          id: randomUUID().slice(0, 16),
          sourceChunkId: sourceChunk.id,
          targetChunkId: targetChunks[0].id,
          relationType: "references",
          confidence: 1.0,
          extractionMethod: "explicit",
          metadata: { linkType: link.type, linkTarget: link.target },
          createdAt: now,
        });
      }

      // 저장
      if (relations.length > 0) {
        insertRelations(db, relations);
      }

      return relations;
    },

    async findSimilarPairs(
      changedChunkIds: string[],
    ): Promise<Array<{ a: string; b: string; similarity: number }>> {
      if (!deps.embedder || !deps.lance || changedChunkIds.length === 0) {
        return [];
      }

      const pairs: Array<{ a: string; b: string; similarity: number }> = [];

      for (const chunkId of changedChunkIds) {
        // 청크 내용 가져오기
        const chunks = db.prepare("SELECT content, section_path FROM chunks WHERE id = ?")
          .get(chunkId) as { content: string; section_path: string } | undefined;
        if (!chunks) continue;

        // 임베딩 → 유사 청크 검색
        const queryText = `${chunks.section_path}\n${chunks.content}`;
        const queryVec = await deps.embedder.embedOne(queryText);
        const similar = await searchSimilar(deps.lance, queryVec, 20);

        for (const s of similar) {
          // 자기 자신 제외, threshold 이상만
          if (s.id === chunkId) continue;
          if (s.similarity >= threshold) {
            // 중복 방지
            const exists = pairs.some(
              (p) => (p.a === chunkId && p.b === s.id) || (p.a === s.id && p.b === chunkId),
            );
            if (!exists) {
              pairs.push({ a: chunkId, b: s.id, similarity: s.similarity });
            }
          }
        }
      }

      return pairs;
    },

    async detectConflictsAI(
      pairs: Array<{ aId: string; aContent: string; bId: string; bContent: string }>,
    ): Promise<Conflict[]> {
      if (!deps.aiProvider || pairs.length === 0) return [];

      const prompt = buildConflictDetectionPrompt(pairs);
      const now = new Date().toISOString();

      try {
        let raw: unknown;
        try {
          raw = await deps.aiProvider.chatJSON<unknown>(prompt);
        } catch (chatErr) {
          // JSON 파싱 실패 (빈 응답 등) → no conflict로 간주
          // provider 자체 에러 (네트워크, timeout 등) → 상위로 전파
          if ((chatErr as Error).message?.includes("No valid JSON")) {
            return [];
          }
          throw chatErr;
        }

        // LLM이 배열 대신 단일 객체를 반환할 수 있음
        const results: Array<{
          pair_index: number;
          is_conflict: boolean;
          severity: string;
          description: string;
        }> = Array.isArray(raw) ? raw : [raw as any];

        const conflicts: Conflict[] = [];

        for (const r of results) {
          if (!r.is_conflict) continue;
          if (r.pair_index < 0 || r.pair_index >= pairs.length) continue;

          const pair = pairs[r.pair_index];
          const conflict: Conflict = {
            id: randomUUID().slice(0, 16),
            chunkAId: pair.aId,
            chunkBId: pair.bId,
            severity: (["low", "medium", "high"].includes(r.severity) ? r.severity : "medium") as Conflict["severity"],
            description: r.description || "Conflict detected by AI",
            status: "open",
            detectedAt: now,
          };

          insertConflict(db, conflict);
          conflicts.push(conflict);
        }

        return conflicts;
      } catch (err) {
        // LLM 실패를 상위로 전파 — 호출자가 에러를 보고해야 함
        throw err;
      }
    },

    getRelations(chunkId: string): Relation[] {
      return getRelationsForChunk(db, chunkId);
    },

    getConflicts(): Conflict[] {
      return getOpenConflicts(db);
    },

    resolve(conflictId: string, resolvedBy: string, note: string): void {
      resolveConflictDB(db, conflictId, resolvedBy, note);
    },

    stats(): { relations: number; openConflicts: number } {
      return {
        relations: getRelationCount(db),
        openConflicts: getConflictCount(db),
      };
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────

function resolveLink(
  target: string,
  allFileIds: Map<string, string>,
): string | null {
  // 정확한 경로 매칭
  if (allFileIds.has(target)) return allFileIds.get(target)!;

  // .md 확장자 추가
  if (!target.endsWith(".md")) {
    const withMd = target + ".md";
    if (allFileIds.has(withMd)) return allFileIds.get(withMd)!;
  }

  // 부분 경로 매칭 (파일명만으로)
  const fileName = target.split("/").pop()!;
  for (const [path, id] of allFileIds) {
    if (path.endsWith(fileName) || path.endsWith(fileName + ".md")) {
      return id;
    }
  }

  return null;
}

function buildConflictDetectionPrompt(
  pairs: Array<{ aId: string; aContent: string; bId: string; bContent: string }>,
): string {
  const pairTexts = pairs.map((p, i) =>
    `--- Pair ${i} ---
Chunk A (${p.aId}):
${p.aContent.slice(0, 500)}

Chunk B (${p.bId}):
${p.bContent.slice(0, 500)}
`).join("\n");

  return `Analyze these document chunk pairs for contradictions or conflicts.
A conflict exists when two chunks make incompatible claims about the same topic.

${pairTexts}

For each pair, determine if there is a conflict.
Respond with a JSON array. Each element:
{
  "pair_index": <number>,
  "is_conflict": <boolean>,
  "severity": "low" | "medium" | "high",
  "description": "<one sentence explaining the conflict, or empty if no conflict>"
}

Only flag TRUE conflicts where the chunks genuinely contradict each other.
Prefer high-precision over high-recall — false positives are worse than false negatives.`;
}
