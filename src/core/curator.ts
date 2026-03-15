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
import { initDatabase, getFileCount, getChunkCount } from "../storage/sqlite.js";
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

// ─── Public API ──────────────────────────────────────────

export interface CuratorDeps {
  embedder: Embedder;
  lance: LanceConnection;
  dbPath: string;
  weights?: ScoringWeights;
}

export async function createCurator(deps: CuratorDeps) {
  const weights = deps.weights ?? DEFAULT_SCORING_WEIGHTS;

  return {
    async assembleContext(req: ContextRequest): Promise<ContextBundle> {
      const maxTokens = req.maxTokens ?? 8000;
      const feedbackToken = randomUUID();

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

      // 4. Budget packing with redundancy + diversity
      const selected = packBudget(scored, maxTokens, weights, req.exclude);

      // 5. Assemble
      const blocks: ContextBlock[] = selected.map((s) => ({
        content: s.result.content,
        source: `${s.result.filePath}#${s.result.sectionPath}`,
        type: s.result.docType,
        relevance: s.finalScore,
        tokens: s.result.tokenCount,
      }));

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

  for (const term of terms) {
    if (target.includes(term)) {
      matches += 1;
      // Identifiers, numbers, filenames get extra boost
      if (/[\d_.\-]/.test(term)) matches += 0.5;
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

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
}
