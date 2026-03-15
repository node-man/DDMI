/**
 * ddmi — Document-Driven Memory Infrastructure
 *
 * Shared type definitions used across all modules.
 * This file is the single source of truth for data structures.
 */

// ─── File & Chunk ────────────────────────────────────────

export interface FileRecord {
  id: string; // SHA-256(relativePath) 앞 16자
  path: string; // project root 기준 상대 경로
  title: string | null;
  docType: string; // decision, spec, meeting, research, sprint, task, agent, ...
  frontmatter: Record<string, unknown>;
  checksum: string; // 파일 내용 SHA-256
  totalTokens: number;
  completenessScore: number; // 체크리스트 완성도 0~1
  createdAt: string; // ISO 8601
  updatedAt: string;
  indexedAt: string;
}

export interface ChunkRecord {
  id: string; // SHA-256(fileId + sectionPath) 앞 16자
  fileId: string;
  sectionPath: string; // "## 개요 > ### 배경"
  content: string;
  tokenCount: number;
  headingLevel: number;
  chunkType: "prose" | "code" | "checklist" | "table";
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Parsing ─────────────────────────────────────────────

export interface ParsedDocument {
  path: string;
  title: string | null;
  docType: string;
  frontmatter: Record<string, unknown>;
  sections: Section[];
  links: ExplicitLink[];
  checklistScore: number;
}

export interface Section {
  heading: string;
  headingLevel: number;
  content: string;
  children: Section[];
}

export interface ExplicitLink {
  type: "wikilink" | "markdown";
  target: string; // resolved path or raw link
  text: string;
  sourceSection: string;
}

// ─── Context Curator ─────────────────────────────────────

export interface ContextRequest {
  intent: string;
  taskType: "implementation" | "review" | "research" | "planning";
  maxTokens?: number; // default 8000
  priority?: string[];
  exclude?: string[];
  timeRange?: { after?: string; before?: string };
  debug?: boolean;
}

export interface ContextBundle {
  blocks: ContextBlock[];
  metaSummary: string;
  totalTokens: number;
  coverageScore: number;
  feedbackToken: string;
  debugScores?: DebugScore[];
}

export interface ContextBlock {
  content: string;
  source: string; // "decisions/adr-007.md#캐시-전략"
  type: string; // doc_type
  relevance: number; // 0~1
  tokens: number;
}

export interface DebugScore {
  source: string;
  semanticSim: number;
  keywordBoost: number;
  taskAwareAuthority: number;
  recency: number;
  redundancyPenalty: number;
  finalScore: number;
  selected: boolean;
}

// ─── Scoring Config ──────────────────────────────────────

export interface ScoringWeights {
  semanticSim: number; // 0.55 default
  keywordBoost: number; // 0.15
  taskAwareAuthority: number; // 0.15
  recency: number; // 0.15 (adaptive)
  redundancyPenalty: number; // 1.5
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  semanticSim: 0.55,
  keywordBoost: 0.15,
  taskAwareAuthority: 0.15,
  recency: 0.15,
  redundancyPenalty: 1.5,
};

// Task-aware authority matrix: [docType][taskType] → score
export const TASK_AWARE_AUTHORITY: Record<string, Record<string, number>> = {
  decision: { implementation: 1.0, review: 0.9, research: 0.6, planning: 0.8 },
  spec: { implementation: 0.9, review: 0.8, research: 0.4, planning: 0.9 },
  meeting: { implementation: 0.4, review: 0.5, research: 0.5, planning: 0.7 },
  research: { implementation: 0.3, review: 0.4, research: 1.0, planning: 0.5 },
  sprint: { implementation: 0.6, review: 0.4, research: 0.2, planning: 1.0 },
  task: { implementation: 0.7, review: 0.5, research: 0.2, planning: 0.6 },
  agent: { implementation: 0.5, review: 0.8, research: 0.2, planning: 0.3 },
};

// ─── Feedback ────────────────────────────────────────────

export interface FeedbackInput {
  feedbackToken: string;
  outcome: "helpful" | "partial" | "irrelevant" | "missing";
  blocksUsed?: string[];
  blocksIrrelevant?: string[];
  missingContext?: string;
}

export interface FeedbackRecord extends FeedbackInput {
  id: string; // FB-YYYY-MMDD-NNN
  timestamp: string;
  intent: string;
  taskType: string;
  blocksServed: string[];
  scoringWeights: ScoringWeights;
}

// ─── Vector Search ───────────────────────────────────────

export interface VectorRecord {
  id: string; // chunk_id
  vector: number[];
  fileId: string;
  filePath: string;
  sectionPath: string;
  content: string;
  docType: string;
  date: string;
  tokenCount: number;
}

export interface SearchResult extends VectorRecord {
  distance: number; // L2 distance from LanceDB
  similarity: number; // 1 - distance (cosine)
}

// ─── AI Provider ────────────────────────────────────────

export interface AIProvider {
  name: string;
  chat(prompt: string): Promise<string>;
  chatJSON<T>(prompt: string): Promise<T>;
  healthCheck(): Promise<boolean>;
}

export interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;
  healthCheck(): Promise<boolean>;
}

export type AITaskType =
  | "relation_extraction"
  | "conflict_detection"
  | "entity_extraction"
  | "doc_classification"
  | "conflict_analysis"
  | "impact_analysis"
  | "knowledge_query";

export interface AITask {
  id: string;
  type: AITaskType;
  priority: "immediate" | "batch";
  prompt: string;
  context?: Record<string, unknown>;
}

export type DegradationLevel = 0 | 1 | 2;

export interface AIRouterConfig {
  defaultProvider: string; // "auto" | "claude" | "ollama" | "api"
  taskOverrides?: Partial<Record<AITaskType, string>>;
}

// ─── Config ──────────────────────────────────────────────

export interface DdmiConfig {
  server: {
    transport: "stdio" | "sse";
    name: string;
    version: string;
  };
  embedding: {
    provider: "transformers";
    model: string;
  };
  curator: {
    defaultMaxTokens: number;
    weights: ScoringWeights;
  };
  ai: {
    defaultProvider: string;
    ollamaUrl: string;
    ollamaModel: string;
  };
  watcher: {
    enabled: boolean;
    debounceMs: number;
    ignorePatterns: string[];
  };
}

export const DEFAULT_CONFIG: DdmiConfig = {
  server: {
    transport: "stdio",
    name: "ddmi",
    version: "0.1.0",
  },
  embedding: {
    provider: "transformers",
    model: "paraphrase-multilingual-MiniLM-L12-v2",
  },
  curator: {
    defaultMaxTokens: 8000,
    weights: DEFAULT_SCORING_WEIGHTS,
  },
  ai: {
    defaultProvider: "auto",
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "llama3.2",
  },
  watcher: {
    enabled: true,
    debounceMs: 2000,
    ignorePatterns: ["node_modules", ".git", ".ddmi"],
  },
};
