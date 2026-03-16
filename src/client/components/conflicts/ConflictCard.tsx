import { useState } from "react";
import { AlertTriangle, CheckCircle, Blocks, Sparkles, Loader2 } from "lucide-react";
import type { Conflict } from "../../lib/client";
import { api } from "../../lib/client";

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const SEVERITY_BORDER: Record<string, string> = {
  high: "border-red-800/50",
  medium: "border-yellow-800/50",
  low: "border-green-800/50",
};

interface Props {
  conflict: Conflict;
  onResolve: (id: string) => void;
  resolving: boolean;
}

export function ConflictCard({ conflict, onResolve, resolving }: Props) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const badgeClass = SEVERITY_STYLES[conflict.severity] ?? SEVERITY_STYLES.low;
  const borderClass = SEVERITY_BORDER[conflict.severity] ?? "border-zinc-800";
  const detectedDate = new Date(conflict.detectedAt).toLocaleString();

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await api.analyzeConflict(conflict.id);
      setAnalysis(result.analysis);
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className={`rounded-lg border ${borderClass} bg-zinc-900/60 p-4`}>
      {/* Header: severity badge + timestamp */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-zinc-400" />
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${badgeClass} uppercase tracking-wide`}>
            {conflict.severity}
          </span>
        </div>
        <span className="text-[11px] text-zinc-500">{detectedDate}</span>
      </div>

      {/* Description */}
      <p className="text-sm text-zinc-300 mb-3 leading-relaxed">
        {conflict.description || "No description provided"}
      </p>

      {/* Chunk IDs */}
      <div className="flex items-center gap-4 mb-4 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Blocks className="w-3 h-3" />
          <span className="font-mono">{conflict.chunkAId.slice(0, 12)}...</span>
        </div>
        <span className="text-zinc-700">vs</span>
        <div className="flex items-center gap-1.5">
          <Blocks className="w-3 h-3" />
          <span className="font-mono">{conflict.chunkBId.slice(0, 12)}...</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onResolve(conflict.id)}
          disabled={resolving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-zinc-800 text-zinc-300 border border-zinc-700
            hover:bg-zinc-700 hover:text-zinc-100 hover:border-zinc-600
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          {resolving ? "Resolving..." : "Resolve"}
        </button>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !!analysis}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-purple-900/30 text-purple-300 border border-purple-700/40
            hover:bg-purple-800/30 hover:text-purple-200 hover:border-purple-600/40
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {analyzing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {analyzing ? "Analyzing..." : analysis ? "Analyzed" : "Analyze"}
        </button>
      </div>

      {/* Analysis error */}
      {analyzeError && (
        <div className="mt-3 text-xs text-red-400 bg-red-950/30 border border-red-800 rounded p-2">
          {analyzeError}
        </div>
      )}

      {/* Analysis result */}
      {analysis && (
        <div className="mt-3 bg-zinc-950 border border-purple-800/30 rounded-md p-3">
          <p className="text-[11px] text-purple-400 uppercase tracking-wide font-medium mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            AI Analysis
          </p>
          <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {analysis}
          </div>
        </div>
      )}
    </div>
  );
}
