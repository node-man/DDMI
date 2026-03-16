/**
 * API client — 타입 안전한 fetch wrapper
 */

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────

export interface HealthData {
  files: number;
  chunks: number;
  relations: number;
  openConflicts: number;
  auditEvents: number;
  chainValid: boolean;
  chainChecked: number;
}

export interface Conflict {
  id: string;
  chunkAId: string;
  chunkBId: string;
  severity: "low" | "medium" | "high";
  description: string;
  status: string;
  detectedAt: string;
}

export interface AuditEvent {
  id: string;
  eventType: string;
  timestamp: string;
  actor: string;
  targetFile?: string;
  rationale?: string;
}

export interface FileItem {
  id: string;
  path: string;
  title: string | null;
  docType: string;
  totalTokens: number;
  completenessScore: number;
  updatedAt: string;
}

export interface ChunkItem {
  id: string;
  fileId: string;
  sectionPath: string;
  content: string;
  tokenCount: number;
  chunkType: string;
}

export interface SearchResult {
  chunkId: string;
  fileId: string;
  filePath: string;
  sectionPath: string;
  content: string;
  docType: string;
  tokenCount: number;
  rank: number;
}

export interface GraphNode {
  id: string;
  label: string;
  docType: string;
  totalTokens: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ProviderInfo {
  name: string;
  type: "cli" | "ollama";
  status: "available" | "unavailable";
  models?: string[];
}

export interface IndexStatus {
  running: boolean;
  progress?: string;
  lastResult?: string;
  lastIndexedAt?: string;
}

// ─── API Calls ────────────────────────────────────────

export const api = {
  health: () => get<HealthData>("/health"),
  conflicts: () => get<Conflict[]>("/conflicts"),
  resolveConflict: (id: string, resolvedBy: string, note: string) =>
    post<{ success: boolean }>(`/conflicts/${id}/resolve`, { resolvedBy, note }),
  analyzeConflict: (id: string) =>
    post<{ analysis: string }>(`/conflicts/${id}/analyze`, {}),
  audit: (limit = 50, type?: string, file?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (type) params.set("type", type);
    if (file) params.set("file", file);
    return get<AuditEvent[]>(`/audit?${params}`);
  },
  files: () => get<FileItem[]>("/files"),
  fileChunks: (fileId: string) => get<ChunkItem[]>(`/files/${fileId}/chunks`),
  search: (query: string) => get<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`),
  graph: () => get<GraphData>("/graph"),
  providers: () => get<ProviderInfo[]>("/providers"),
  startIndex: (provider?: string, incremental?: boolean) =>
    post<{ started: boolean }>("/index", { provider, incremental }),
  indexStatus: () => get<IndexStatus>("/index/status"),
  knowledgeQuery: (question: string) =>
    post<{ answer: string }>("/knowledge-query", { question }),
};
