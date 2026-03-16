import { useEffect, useState, useCallback } from "react";
import { Shield, CheckCircle } from "lucide-react";
import { api, type Conflict } from "../../lib/client";
import { ConflictCard } from "./ConflictCard";

export function ConflictsPage() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadConflicts = useCallback(() => {
    setLoading(true);
    api
      .conflicts()
      .then(setConflicts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  const handleResolve = useCallback(
    (id: string) => {
      const note = prompt("Resolution note:");
      if (note === null) return; // cancelled

      setResolvingId(id);
      api
        .resolveConflict(id, "human", note)
        .then(() => {
          // 해결된 충돌을 목록에서 제거
          setConflicts((prev) => prev.filter((c) => c.id !== id));
        })
        .catch((e) => setError(e.message))
        .finally(() => setResolvingId(null));
    },
    [],
  );

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-red-400 text-sm">
          API Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-yellow-400" />
          Conflict Studio
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          충돌을 검토하고 해결합니다
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading conflicts...</div>
        ) : conflicts.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500/30" />
              <p className="text-sm text-zinc-400 font-medium">No open conflicts</p>
              <p className="text-xs text-zinc-600 mt-1">
                All conflicts have been resolved
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl">
            {/* Count badge */}
            <div className="text-sm text-zinc-400 mb-4">
              <span className="text-zinc-200 font-medium">{conflicts.length}</span>{" "}
              open conflict{conflicts.length !== 1 ? "s" : ""}
            </div>

            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                onResolve={handleResolve}
                resolving={resolvingId === conflict.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
