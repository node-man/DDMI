import { useEffect, useState } from "react";
import { GitBranch, Share2, AlertTriangle } from "lucide-react";
import { api, type GraphData } from "../../lib/client";
import { KnowledgeGraph } from "./KnowledgeGraph";

export function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .graph()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-red-400 text-sm">
          API Error: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-zinc-500">Loading graph...</div>;
  }

  const conflictEdges = data.edges.filter((e) => e.type === "contradicts").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-blue-400" />
            Knowledge Graph
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            파일 간 관계를 시각화합니다
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Share2 className="w-3.5 h-3.5" />
            <span className="text-zinc-200 font-medium">{data.nodes.length}</span> nodes
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <GitBranch className="w-3.5 h-3.5" />
            <span className="text-zinc-200 font-medium">{data.edges.length}</span> edges
          </div>
          {conflictEdges > 0 && (
            <div className="flex items-center gap-1.5 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-medium">{conflictEdges}</span> contradicts
            </div>
          )}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 min-h-0">
        {data.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No indexed files yet</p>
              <p className="text-xs text-zinc-600 mt-1">
                Run <code className="bg-zinc-800 px-1.5 py-0.5 rounded">ddmi index</code> to populate the graph
              </p>
            </div>
          </div>
        ) : (
          <KnowledgeGraph data={data} />
        )}
      </div>

      {/* Legend */}
      <div className="px-6 py-2 border-t border-zinc-800 flex items-center gap-6 text-xs text-zinc-500 flex-shrink-0">
        <span className="font-medium text-zinc-400">Edges:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-blue-500 inline-block rounded" /> references / depends_on
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-purple-500 inline-block rounded" /> derived_from
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-red-500 inline-block rounded animate-pulse" /> contradicts
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-yellow-500 inline-block rounded" /> supersedes
        </span>
      </div>
    </div>
  );
}
