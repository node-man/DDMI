import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Zap, Database, Loader2 } from "lucide-react";
import { api, type IndexStatus } from "../../lib/client";

export function IndexControl() {
  const [status, setStatus] = useState<IndexStatus>({ running: false });
  const [error, setError] = useState<string | null>(null);

  const pollStatus = useCallback(() => {
    api
      .indexStatus()
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    pollStatus();
    const timer = setInterval(pollStatus, 2000);
    return () => clearInterval(timer);
  }, [pollStatus]);

  const startIndex = async (mode: "fast" | "ai" | "full") => {
    setError(null);
    try {
      const incremental = mode !== "full";
      const provider = mode === "ai" ? "auto" : undefined;
      await api.startIndex(provider, incremental);
      pollStatus();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <h3 className="text-sm font-medium text-zinc-200 mb-3">Indexing</h3>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => startIndex("fast")}
          disabled={status.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-zinc-800 text-zinc-300 border border-zinc-700
            hover:bg-zinc-700 hover:text-zinc-100 hover:border-zinc-600
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Index (fast)
        </button>
        <button
          onClick={() => startIndex("ai")}
          disabled={status.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-blue-900/40 text-blue-300 border border-blue-700/50
            hover:bg-blue-800/40 hover:text-blue-200 hover:border-blue-600/50
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Database className="w-3.5 h-3.5" />
          Index + AI
        </button>
        <button
          onClick={() => startIndex("full")}
          disabled={status.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-zinc-800 text-zinc-300 border border-zinc-700
            hover:bg-zinc-700 hover:text-zinc-100 hover:border-zinc-600
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reindex
        </button>
      </div>

      {/* Status */}
      {status.running && (
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{status.progress || "Indexing..."}</span>
        </div>
      )}

      {!status.running && status.lastResult && (
        <div className="mt-2">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide font-medium mb-1">
            Last Result
          </p>
          <pre className="text-xs text-zinc-400 bg-zinc-950 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
            {status.lastResult}
          </pre>
        </div>
      )}

      {status.lastIndexedAt && (
        <p className="text-[11px] text-zinc-500 mt-2">
          Last indexed: {new Date(status.lastIndexedAt).toLocaleString()}
        </p>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-400 bg-red-950/30 border border-red-800 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}
