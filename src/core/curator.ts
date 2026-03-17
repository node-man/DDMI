/**
 * Context Curator — ddmi의 심장
 *
 * Agent 질의를 받아 최적의 컨텍스트를 조립한다.
 * 파이프라인: 질의 임베딩 → 벡터 검색 → 스코어링 → 예산 패킹 → 조립
 *
 * 핵심: 이 모듈에 LLM 호출은 0회. 전부 전통 알고리즘.
 */

import { randomUUID } from "node:crypto";
import { createEmbedder, type Embedder } from "./embedder.js";
import {
  initDatabase,
  getFileCount,
  getChunkCount,
  getChunksByFileId,
  searchBM25,
  getOpenConflicts,
  getAllRelations,
} from "../storage/sqlite.js";
import {
  initVectorStore,
  searchSimilar,
  type LanceConnection,
} from "../storage/lance.js";
import type {
  ContextRequest,
  ContextBundle,
  ContextBlock,
  DebugScore,
  SearchResult,
  ScoringWeights,
} from "../types.js";
import { DEFAULT_SCORING_WEIGHTS, TASK_AWARE_AUTHORITY } from "../types.js";

const TOP_K_POOL = 50;
const MAX_SELECT = 10;
const REDUNDANCY_SKIP = 0.95;
const REDUNDANCY_PENALIZE = 0.85;
const RECENCY_DATE_SPREAD_THRESHOLD = 30; // days
const SIBLING_MAX_PER_FILE = 3; // 파일당 추가 sibling 최대 수
const SIBLING_BUDGET_RATIO = 0.30; // direct budget의 30%까지 sibling에 사용
const RELATION_BUDGET_RATIO = 0.20; // direct budget의 20%까지 relation expansion에 사용
const RELATION_MAX_CHUNKS = 5; // 관계 확장으로 추가할 최대 청크 수

/** 관계 유형별 가중치 — 높을수록 확장 우선 */
const RELATION_TYPE_WEIGHTS: Record<string, number> = {
  depends_on: 1.0,
  derived_from: 0.8,
  references: 0.7,
  supersedes: 0.5,
  contradicts: 0.3,
};

// ─── Public API ──────────────────────────────────────────

export interface CuratorDeps {
  embedder: Embedder | null;
  lance: LanceConnection | null;
  dbPath: string;
  weights?: ScoringWeights;
}

export async function createCurator(deps: CuratorDeps) {
  const weights = deps.weights ?? DEFAULT_SCORING_WEIGHTS;

  return {
    async assembleContext(req: ContextRequest): Promise<ContextBundle> {
      const maxTokens = req.maxTokens ?? 8000;
      const feedbackToken = randomUUID();

      // Level 0 fallback: BM25 keyword search (no embedder/lance)
      if (!deps.embedder || !deps.lance) {
        return assembleLevel0(deps.dbPath, req, feedbackToken, weights);
      }

      // 1. Embed query
      const queryVec = await deps.embedder.embedOne(req.intent);

      // 2. Vector search (top-K pool)
      const candidates = await searchSimilar(deps.lance, queryVec, TOP_K_POOL);

      if (candidates.length === 0) {
        return emptyBundle(feedbackToken, deps.dbPath);
      }

      // 3. Score each candidate
      const scored = scoreCandidates(
        candidates,
        req.intent,
        req.taskType,
        weights,
      );

      // 4. Budget allocation: 90% direct, 10% conflicts
      const conflictBudget = Math.floor(maxTokens * 0.10);
      const directBudget = maxTokens - conflictBudget;

      // 4a. Direct context packing
      const packed = packBudget(scored, directBudget, weights, req.exclude);

      // 4b. Sibling section expansion — 선택된 청크의 같은 파일에서 인접 섹션 자동 포함
      const afterSiblings = expandSiblings(packed, scored, directBudget, deps.dbPath, req.exclude);

      // 4c. Relation expansion — AI 추출 관계가 있는 다른 파일의 청크 포함
      const selected = req.noRelations
        ? afterSiblings
        : expandRelations(afterSiblings, directBudget, deps.dbPath, req.exclude);

      // 4d. Conflict context (open conflicts involving selected chunks)
      const conflictBlocks = getConflictBlocks(deps.dbPath, selected, conflictBudget);

      // 5. Assemble
      const blocks: ContextBlock[] = [
        ...selected.map((s) => ({
          content: s.result.content,
          source: `${s.result.filePath}#${s.result.sectionPath}`,
          type: s.result.docType,
          relevance: s.finalScore,
          tokens: s.result.tokenCount,
        })),
        ...conflictBlocks,
      ];

      const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
      const coverageScore = computeCoverage(candidates, selected);

      // Meta summary
      const db = initDatabase(deps.dbPath);
      const fileCount = getFileCount(db);
      const chunkCount = getChunkCount(db);
      db.close();

      const metaSummary = `Project: ${fileCount} files, ${chunkCount} chunks indexed. Selected ${blocks.length} blocks (${totalTokens} tokens).`;

      // Debug scores
      const debugScores: DebugScore[] | undefined = req.debug
        ? scored.map((s) => ({
            source: `${s.result.filePath}#${s.result.sectionPath}`,
            semanticSim: s.semanticSim,
            keywordBoost: s.keywordBoost,
            taskAwareAuthority: s.taskAwareAuthority,
            recency: s.recency,
            redundancyPenalty: s.redundancyPenalty,
            finalScore: s.finalScore,
            selected: selected.includes(s),
          }))
        : undefined;

      return {
        blocks,
        metaSummary,
        totalTokens,
        coverageScore,
        feedbackToken,
        debugScores,
      };
    },
  };
}

// ─── Exported for testing ────────────────────────────────

export { scoreCandidates, packBudget, expandSiblings, expandRelations, computeKeywordBoost, computeCoverage };
export type { ScoredCandidate };

// ─── Scoring ─────────────────────────────────────────────

interface ScoredCandidate {
  result: SearchResult;
  semanticSim: number;
  keywordBoost: number;
  taskAwareAuthority: number;
  recency: number;
  rawScore: number;
  redundancyPenalty: number;
  finalScore: number;
}

function scoreCandidates(
  candidates: SearchResult[],
  query: string,
  taskType: string,
  weights: ScoringWeights,
): ScoredCandidate[] {
  // Adaptive recency: check date spread
  const dates = candidates
    .map((c) => parseDate(c.date))
    .filter((d): d is Date => d !== null);
  const dateSpread =
    dates.length >= 2
      ? (Math.max(...dates.map((d) => d.getTime())) -
          Math.min(...dates.map((d) => d.getTime()))) /
        (1000 * 60 * 60 * 24)
      : 0;
  const recencyActive = dateSpread > RECENCY_DATE_SPREAD_THRESHOLD;

  // Redistribute recency weight to semantic_sim if inactive
  let wSim = weights.semanticSim;
  let wRec = weights.recency;
  if (!recencyActive) {
    wSim += wRec;
    wRec = 0;
  }

  const now = new Date();

  return candidates.map((r) => {
    const semanticSim = r.similarity;
    const keywordBoost = computeKeywordBoost(query, r.content, r.sectionPath, r.filePath);
    const taskAwareAuthority =
      TASK_AWARE_AUTHORITY[r.docType]?.[taskType] ?? 0.5;

    let recency = 0.5;
    if (recencyActive) {
      const d = parseDate(r.date);
      if (d) {
        const daysAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
        recency = Math.max(0, 1 - daysAgo / 365);
      }
    }

    const rawScore =
      wSim * semanticSim +
      weights.keywordBoost * keywordBoost +
      weights.taskAwareAuthority * taskAwareAuthority +
      wRec * recency;

    return {
      result: r,
      semanticSim,
      keywordBoost,
      taskAwareAuthority,
      recency,
      rawScore,
      redundancyPenalty: 0,
      finalScore: rawScore,
    };
  });
}

// ─── Keyword Boost ───────────────────────────────────────

function computeKeywordBoost(
  query: string,
  content: string,
  sectionPath: string,
  filePath: string,
): number {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.toLowerCase());
  if (terms.length === 0) return 0;

  const target = `${content} ${sectionPath} ${filePath}`.toLowerCase();
  let matches = 0;

  // target with whitespace collapsed for Korean substring matching
  const targetCompact = target.replace(/\s+/g, "");

  for (const term of terms) {
    if (target.includes(term)) {
      matches += 1;
      // Identifiers, numbers, filenames get extra boost
      if (/[\d_.\-]/.test(term)) matches += 0.5;
    } else if (term.length >= 2 && targetCompact.includes(term)) {
      // Korean compound word match: "캐시전략" → "캐시 전략"
      matches += 0.8;
    }
  }

  return Math.min(1.0, matches / terms.length);
}

// ─── Budget Packing ──────────────────────────────────────

function packBudget(
  scored: ScoredCandidate[],
  budget: number,
  weights: ScoringWeights,
  exclude?: string[],
): ScoredCandidate[] {
  // Sort by raw score descending
  const sorted = [...scored].sort((a, b) => b.rawScore - a.rawScore);

  const selected: ScoredCandidate[] = [];
  const selectedSims: number[] = [];
  const selectedFiles = new Set<string>();
  let totalTokens = 0;

  for (const candidate of sorted) {
    // Exclusion filter
    if (exclude?.some((ex) => candidate.result.filePath.includes(ex))) continue;

    // Budget check
    if (totalTokens + candidate.result.tokenCount > budget) continue;

    // Redundancy check (use similarity scores as proxy since LanceDB may not return vectors)
    if (selectedSims.length > 0) {
      // Approximate inter-chunk similarity from their query similarities
      // Two chunks with similar query-similarity AND same file are likely redundant
      const maxOverlap = Math.max(
        ...selectedSims.map((ss, idx) => {
          const simDiff = Math.abs(candidate.semanticSim - ss);
          const sameFile =
            candidate.result.filePath === selected[idx].result.filePath;
          // High sim to query + same file = likely redundant
          return sameFile ? 1.0 - simDiff * 2 : 1.0 - simDiff * 5;
        }),
      );

      if (maxOverlap > REDUNDANCY_SKIP) continue;

      const isNewFile = !selectedFiles.has(candidate.result.filePath);
      const threshold = isNewFile ? 0.90 : REDUNDANCY_PENALIZE;

      const penalty =
        Math.max(0, maxOverlap - threshold) * weights.redundancyPenalty;
      candidate.redundancyPenalty = penalty;
      candidate.finalScore = candidate.rawScore - penalty;
    }

    selected.push(candidate);
    selectedSims.push(candidate.semanticSim);
    selectedFiles.add(candidate.result.filePath);
    totalTokens += candidate.result.tokenCount;

    if (selected.length >= MAX_SELECT) break;
  }

  return selected;
}

// ─── Sibling Section Expansion ───────────────────────────

/**
 * 선택된 청크의 같은 파일에서 인접 섹션을 자동 포함한다.
 *
 * 전략:
 * - 선택된 파일별로, DB에서 같은 파일의 모든 청크를 가져온다
 * - 선택된 청크의 rowid 기준으로 인접 청크(바로 앞/뒤)를 우선 확장
 * - 예산(direct budget의 SIBLING_BUDGET_RATIO)과 파일당 최대 수 제한
 * - 이미 scored pool에 있는 청크는 해당 스코어 유지, 없으면 0.5 baseline
 */
function expandSiblings(
  selected: ScoredCandidate[],
  allScored: ScoredCandidate[],
  directBudget: number,
  dbPath: string,
  exclude?: string[],
): ScoredCandidate[] {
  if (selected.length === 0) return selected;

  const usedTokens = selected.reduce((s, c) => s + c.result.tokenCount, 0);
  const siblingBudget = Math.min(
    directBudget - usedTokens,
    Math.floor(directBudget * SIBLING_BUDGET_RATIO),
  );
  if (siblingBudget <= 0) return selected;

  const selectedIds = new Set(selected.map((s) => s.result.id));
  const scoredMap = new Map(allScored.map((s) => [s.result.id, s]));

  // 파일별 선택된 청크 그룹핑
  const fileGroups = new Map<string, ScoredCandidate[]>();
  for (const s of selected) {
    const arr = fileGroups.get(s.result.fileId) ?? [];
    arr.push(s);
    fileGroups.set(s.result.fileId, arr);
  }

  const db = initDatabase(dbPath);
  const siblings: ScoredCandidate[] = [];
  let siblingTokens = 0;

  try {
    for (const [fileId, fileSelected] of fileGroups) {
      // 파일당 sibling 추가 수 제한
      let addedForFile = 0;

      const allChunks = getChunksByFileId(db, fileId);
      if (allChunks.length <= 1) continue;

      // 선택된 청크의 인덱스 찾기
      const selectedIndices = new Set<number>();
      for (const sel of fileSelected) {
        const idx = allChunks.findIndex((c) => c.id === sel.result.id);
        if (idx >= 0) selectedIndices.add(idx);
      }

      // BFS-like expansion: 선택된 위치에서 가까운 순서로 인접 청크 수집
      const candidateIndices: number[] = [];
      for (const idx of selectedIndices) {
        // 바로 앞/뒤 우선
        if (idx > 0 && !selectedIndices.has(idx - 1)) candidateIndices.push(idx - 1);
        if (idx < allChunks.length - 1 && !selectedIndices.has(idx + 1)) candidateIndices.push(idx + 1);
      }
      // 중복 제거, 순서 유지
      const seen = new Set<number>();
      const uniqueIndices = candidateIndices.filter((i) => {
        if (seen.has(i)) return false;
        seen.add(i);
        return true;
      });

      for (const idx of uniqueIndices) {
        if (addedForFile >= SIBLING_MAX_PER_FILE) break;
        if (siblingTokens >= siblingBudget) break;

        const chunk = allChunks[idx];
        if (selectedIds.has(chunk.id)) continue;
        if (exclude?.some((ex) => chunk.id.includes(ex))) continue;
        if (siblingTokens + chunk.tokenCount > siblingBudget) continue;

        // scored pool에 있으면 기존 스코어 사용, 없으면 synthetic
        const existing = scoredMap.get(chunk.id);
        const candidate: ScoredCandidate = existing ?? {
          result: {
            id: chunk.id,
            vector: [],
            fileId: chunk.fileId,
            filePath: fileSelected[0].result.filePath,
            sectionPath: chunk.sectionPath,
            content: chunk.content,
            docType: fileSelected[0].result.docType,
            date: fileSelected[0].result.date,
            tokenCount: chunk.tokenCount,
            distance: 0,
            similarity: 0,
          },
          semanticSim: 0,
          keywordBoost: 0,
          taskAwareAuthority: fileSelected[0].taskAwareAuthority,
          recency: fileSelected[0].recency,
          rawScore: 0,
          redundancyPenalty: 0,
          finalScore: 0,
        };

        // sibling임을 표시 (finalScore에 반영하지 않지만 debug에서 추적 가능)
        selectedIds.add(chunk.id);
        siblings.push(candidate);
        siblingTokens += chunk.tokenCount;
        addedForFile++;
      }
    }
  } finally {
    db.close();
  }

  return [...selected, ...siblings];
}

// ─── Relation Expansion ─────────────────────────────────

/**
 * 선택된 청크의 파일과 AI 추출 관계가 있는 다른 파일의 청크를 예산 내에서 추가한다.
 *
 * 전략:
 * - 선택된 청크들의 파일 ID를 수집
 * - DB에서 해당 파일 청크와 관계가 있는 다른 파일의 청크를 조회
 * - 관계 신뢰도 × 유형 가중치로 정렬
 * - 예산(direct budget의 RELATION_BUDGET_RATIO)과 최대 수 제한
 */
function expandRelations(
  selected: ScoredCandidate[],
  directBudget: number,
  dbPath: string,
  exclude?: string[],
): ScoredCandidate[] {
  if (selected.length === 0) return selected;

  const usedTokens = selected.reduce((s, c) => s + c.result.tokenCount, 0);
  const relationBudget = Math.min(
    directBudget - usedTokens,
    Math.floor(directBudget * RELATION_BUDGET_RATIO),
  );
  if (relationBudget <= 0) return selected;

  const selectedChunkIds = new Set(selected.map((s) => s.result.id));
  const selectedFileIds = new Set(selected.map((s) => s.result.fileId));

  const db = initDatabase(dbPath);
  try {
    const allRelations = getAllRelations(db);
    if (allRelations.length === 0) return selected;

    // 관계의 chunk ID → file ID 매핑 (관계는 파일의 첫 청크 ID로 저장됨)
    const chunkToFile = new Map<string, string>();
    for (const rel of allRelations) {
      if (!chunkToFile.has(rel.sourceChunkId)) {
        const row = db.prepare("SELECT file_id FROM chunks WHERE id = ?").get(rel.sourceChunkId) as { file_id: string } | undefined;
        if (row) chunkToFile.set(rel.sourceChunkId, row.file_id);
      }
      if (!chunkToFile.has(rel.targetChunkId)) {
        const row = db.prepare("SELECT file_id FROM chunks WHERE id = ?").get(rel.targetChunkId) as { file_id: string } | undefined;
        if (row) chunkToFile.set(rel.targetChunkId, row.file_id);
      }
    }

    // 선택된 파일과 관계가 있는 "다른 파일"의 청크를 찾기
    const relatedFileScores: Array<{ fileId: string; score: number }> = [];

    for (const rel of allRelations) {
      const typeWeight = RELATION_TYPE_WEIGHTS[rel.relationType] ?? 0.5;
      const score = rel.confidence * typeWeight;
      const srcFileId = chunkToFile.get(rel.sourceChunkId);
      const tgtFileId = chunkToFile.get(rel.targetChunkId);
      if (!srcFileId || !tgtFileId) continue;

      // source 파일이 선택됨 → target 파일이 후보
      if (selectedFileIds.has(srcFileId) && !selectedFileIds.has(tgtFileId)) {
        relatedFileScores.push({ fileId: tgtFileId, score });
      }
      // target 파일이 선택됨 → source 파일이 후보
      if (selectedFileIds.has(tgtFileId) && !selectedFileIds.has(srcFileId)) {
        relatedFileScores.push({ fileId: srcFileId, score });
      }
    }

    if (relatedFileScores.length === 0) return selected;

    // 파일별 최고 스코어, 중복 제거
    const fileScoreMap = new Map<string, number>();
    for (const { fileId, score } of relatedFileScores) {
      fileScoreMap.set(fileId, Math.max(fileScoreMap.get(fileId) ?? 0, score));
    }
    const sortedFiles = [...fileScoreMap.entries()].sort((a, b) => b[1] - a[1]);

    const seen = new Set<string>();
    const expansions: ScoredCandidate[] = [];
    let usedRelBudget = 0;

    for (const [relFileId, score] of sortedFiles) {
      if (expansions.length >= RELATION_MAX_CHUNKS) break;
      if (usedRelBudget >= relationBudget) break;

      // 관련 파일의 첫 번째 청크를 추가 (가장 대표적인 섹션)
      const chunks = getChunksByFileId(db, relFileId);
      if (chunks.length === 0) continue;

      const chunk = chunks[0];
      if (selectedChunkIds.has(chunk.id) || seen.has(chunk.id)) continue;
      seen.add(chunk.id);

      const fileRow = db.prepare("SELECT path, doc_type FROM files WHERE id = ?").get(relFileId) as { path: string; doc_type: string } | undefined;
      if (!fileRow) continue;
      if (exclude?.some((ex) => fileRow.path.includes(ex))) continue;
      if (usedRelBudget + chunk.tokenCount > relationBudget) continue;

      expansions.push({
        result: {
          id: chunk.id,
          vector: [],
          fileId: relFileId,
          filePath: fileRow.path,
          sectionPath: chunk.sectionPath,
          content: chunk.content,
          docType: fileRow.doc_type,
          date: "",
          tokenCount: chunk.tokenCount,
          distance: 0,
          similarity: 0,
        },
        semanticSim: 0,
        keywordBoost: 0,
        taskAwareAuthority: 0.5,
        recency: 0.5,
        rawScore: 0,
        redundancyPenalty: 0,
        finalScore: score,
      });

      usedRelBudget += chunk.tokenCount;
    }

    return [...selected, ...expansions];
  } finally {
    db.close();
  }
}

// ─── Coverage Score ──────────────────────────────────────

function computeCoverage(
  allCandidates: SearchResult[],
  selected: ScoredCandidate[],
): number {
  if (allCandidates.length === 0) return 0;
  if (selected.length === 0) return 0;

  // Coverage = how well selected blocks cover the query space
  // Measured by: 1 - avg similarity of top unselected candidates
  const selectedIds = new Set(selected.map((s) => s.result.id));
  const unselected = allCandidates
    .filter((c) => !selectedIds.has(c.id))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);

  if (unselected.length === 0) return 1.0;

  const avgUnselectedSim =
    unselected.reduce((s, c) => s + c.similarity, 0) / unselected.length;

  return Math.min(1.0, Math.max(0, 1 - avgUnselectedSim));
}

// ─── Helpers ─────────────────────────────────────────────

function emptyBundle(feedbackToken: string, dbPath: string): ContextBundle {
  const db = initDatabase(dbPath);
  const fileCount = getFileCount(db);
  db.close();

  return {
    blocks: [],
    metaSummary: `Project: ${fileCount} files indexed. No matching context found.`,
    totalTokens: 0,
    coverageScore: 0,
    feedbackToken,
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Conflict Blocks ─────────────────────────────────────

function getConflictBlocks(
  dbPath: string,
  selected: ScoredCandidate[],
  budget: number,
): ContextBlock[] {
  const db = initDatabase(dbPath);
  try {
    const conflicts = getOpenConflicts(db);
    if (conflicts.length === 0) return [];

    const selectedIds = new Set(selected.map((s) => s.result.id));
    const blocks: ContextBlock[] = [];
    let usedTokens = 0;

    for (const c of conflicts) {
      // 선택된 청크와 관련된 충돌만 포함
      if (!selectedIds.has(c.chunkAId) && !selectedIds.has(c.chunkBId)) continue;

      const warningBlock: ContextBlock = {
        content: `⚠ CONFLICT (${c.severity}): ${c.description}\nChunks: ${c.chunkAId} vs ${c.chunkBId}`,
        source: `conflict:${c.id}`,
        type: "conflict",
        relevance: c.severity === "high" ? 1.0 : c.severity === "medium" ? 0.7 : 0.4,
        tokens: Math.ceil(c.description.length / 4) + 20,
      };

      if (usedTokens + warningBlock.tokens > budget) break;
      blocks.push(warningBlock);
      usedTokens += warningBlock.tokens;
    }

    return blocks;
  } finally {
    db.close();
  }
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
}

// ─── Level 0: BM25 fallback ─────────────────────────────

function assembleLevel0(
  dbPath: string,
  req: ContextRequest,
  feedbackToken: string,
  weights: ScoringWeights,
): ContextBundle {
  const db = initDatabase(dbPath);

  try {
    const ftsResults = searchBM25(db, req.intent, TOP_K_POOL);

    if (ftsResults.length === 0) {
      const fileCount = getFileCount(db);
      return {
        blocks: [],
        metaSummary: `Project: ${fileCount} files indexed. No matching context found (Level 0 — BM25).`,
        totalTokens: 0,
        coverageScore: 0,
        feedbackToken,
      };
    }

    // Convert FTS results to SearchResult-like format for scoring
    const candidates: SearchResult[] = ftsResults.map((r) => ({
      id: r.chunkId,
      vector: [],
      fileId: r.fileId,
      filePath: r.filePath,
      sectionPath: r.sectionPath,
      content: r.content,
      docType: r.docType,
      date: "",
      tokenCount: r.tokenCount,
      distance: 0,
      // Normalize BM25 rank to 0-1 similarity (rank is negative, lower = better)
      similarity: Math.max(0, Math.min(1, 1 + r.rank / 20)),
    }));

    const scored = scoreCandidates(candidates, req.intent, req.taskType, weights);
    const maxTokens = req.maxTokens ?? 8000;
    const packed = packBudget(scored, maxTokens, weights, req.exclude);
    const selected = expandSiblings(packed, scored, maxTokens, dbPath, req.exclude);

    const blocks: ContextBlock[] = selected.map((s) => ({
      content: s.result.content,
      source: `${s.result.filePath}#${s.result.sectionPath}`,
      type: s.result.docType,
      relevance: s.finalScore,
      tokens: s.result.tokenCount,
    }));

    const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
    const fileCount = getFileCount(db);
    const chunkCount = getChunkCount(db);

    return {
      blocks,
      metaSummary: `Project: ${fileCount} files, ${chunkCount} chunks indexed. Selected ${blocks.length} blocks (${totalTokens} tokens). [Level 0 — BM25]`,
      totalTokens,
      coverageScore: computeCoverage(candidates, selected),
      feedbackToken,
    };
  } finally {
    db.close();
  }
}
