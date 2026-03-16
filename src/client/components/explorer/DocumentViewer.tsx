import Markdown from "react-markdown";
import type { FileItem, ChunkItem } from "../../lib/client";

const chunkTypeBadge: Record<string, string> = {
  prose: "bg-zinc-800 text-zinc-400",
  code: "bg-sky-900/50 text-sky-400",
  checklist: "bg-amber-900/50 text-amber-400",
  table: "bg-emerald-900/50 text-emerald-400",
  frontmatter: "bg-violet-900/50 text-violet-400",
};

interface DocumentViewerProps {
  file: FileItem | null;
  chunks: ChunkItem[];
  loading: boolean;
}

export function DocumentViewer({ file, chunks, loading }: DocumentViewerProps) {
  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
        Select a file to view its chunks
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <h3 className="text-sm font-semibold text-zinc-200 truncate">
          {file.title ?? file.path}
        </h3>
        <p className="text-xs text-zinc-500 mt-0.5 font-mono">{file.path}</p>
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-600">
          <span>{chunks.length} chunks</span>
          <span>{file.totalTokens.toLocaleString()} tokens</span>
          <span>updated {file.updatedAt.slice(0, 10)}</span>
        </div>
      </div>

      {/* Chunks */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-zinc-500">Loading chunks...</div>
        ) : chunks.length === 0 ? (
          <div className="text-sm text-zinc-600">No chunks found</div>
        ) : (
          chunks.map((chunk) => {
            const badge =
              chunkTypeBadge[chunk.chunkType] ?? chunkTypeBadge.prose;
            return (
              <div
                key={chunk.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden"
              >
                {/* Chunk header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/60">
                  {chunk.sectionPath && (
                    <span className="text-xs font-medium text-zinc-300 truncate flex-1">
                      {chunk.sectionPath}
                    </span>
                  )}
                  <span
                    className={`inline-flex px-1.5 py-0.5 text-[10px] rounded font-medium flex-shrink-0 ${badge}`}
                  >
                    {chunk.chunkType}
                  </span>
                  <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0">
                    {chunk.tokenCount} tok
                  </span>
                </div>
                {/* Chunk content */}
                <div className="px-3 py-2.5 text-sm text-zinc-300 prose prose-invert prose-sm max-w-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-code:text-sky-400">
                  <Markdown>{chunk.content}</Markdown>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
