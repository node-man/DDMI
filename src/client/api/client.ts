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

// ─── API Calls ────────────────────────────────────────

export const api = {
  health: () => get<HealthData>("/health"),
  conflicts: () => get<Conflict[]>("/conflicts"),
  resolveConflict: (id: string, resolvedBy: string, note: string) =>
    post<{ success: boolean }>(`/conflicts/${id}/resolve`, { resolvedBy, note }),
  audit: (limit = 50) => get<AuditEvent[]>(`/audit?limit=${limit}`),
};
