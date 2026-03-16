import { FileText, Search } from "lucide-react";
import type { FileItem } from "../../lib/client";

const docTypeBadge: Record<string, string> = {
  spec: "bg-blue-900/50 text-blue-400 border-blue-700/50",
  decision: "bg-purple-900/50 text-purple-400 border-purple-700/50",
  meeting: "bg-zinc-800 text-zinc-400 border-zinc-700/50",
  research: "bg-green-900/50 text-green-400 border-green-700/50",
  guide: "bg-amber-900/50 text-amber-400 border-amber-700/50",
  unknown: "bg-zinc-800 text-zinc-500 border-zinc-700/50",
};

interface FileNavigatorProps {
  files: FileItem[];
  selectedFileId: string | null;
  onSelectFile: (file: FileItem) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: () => void;
}

export function FileNavigator({
  files,
  selectedFileId,
  onSelectFile,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}: FileNavigatorProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="p-3 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search chunks (BM25)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchSubmit();
            }}
            className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="p-4 text-sm text-zinc-600 text-center">
            No indexed files
          </div>
        ) : (
          <ul className="py-1">
            {files.map((file) => {
              const isSelected = file.id === selectedFileId;
              const badge = docTypeBadge[file.docType] ?? docTypeBadge.unknown;
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => onSelectFile(file)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      isSelected
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0 text-zinc-600" />
                      <span className="truncate flex-1 font-mono text-xs">
                        {file.path}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 ml-5.5">
                      <span
                        className={`inline-flex px-1.5 py-0.5 text-[10px] rounded border font-medium ${badge}`}
                      >
                        {file.docType}
                      </span>
                      <span className="text-[10px] text-zinc-600 tabular-nums">
                        {file.totalTokens.toLocaleString()} tokens
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">
        {files.length} files
      </div>
    </div>
  );
}
