import type { SearchResult } from "../../lib/client";

interface SearchPanelProps {
  results: SearchResult[];
  loading: boolean;
  query: string;
  onClear: () => void;
}

export function SearchPanel({ results, loading, query, onClear }: SearchPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Search Results
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            &ldquo;{query}&rdquo; &mdash; {results.length} matches
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-800 hover:border-zinc-700 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="text-sm text-zinc-500">Searching...</div>
        ) : results.length === 0 ? (
          <div className="text-sm text-zinc-600">No results found</div>
        ) : (
          results.map((r, i) => (
            <div
              key={`${r.chunkId}-${i}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                  #{i + 1}
                </span>
                <span className="text-xs font-mono text-zinc-400 truncate flex-1">
                  {r.filePath}
                </span>
                <span className="text-[10px] text-zinc-600 tabular-nums">
                  rank {Math.abs(r.rank).toFixed(2)}
                </span>
              </div>
              {r.sectionPath && (
                <div className="text-xs font-medium text-zinc-300 mb-1">
                  {r.sectionPath}
                </div>
              )}
              <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
                {r.content.slice(0, 200)}
                {r.content.length > 200 ? "..." : ""}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
