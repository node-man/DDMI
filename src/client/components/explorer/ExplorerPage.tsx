import { useEffect, useState, useCallback } from "react";
import { api, type FileItem, type ChunkItem, type SearchResult } from "../../lib/client";
import { FileNavigator } from "./FileNavigator";
import { DocumentViewer } from "./DocumentViewer";
import { SearchPanel } from "./SearchPanel";

export function ExplorerPage() {
  // Files
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Load files on mount
  useEffect(() => {
    api
      .files()
      .then(setFiles)
      .catch((e) => setError(e.message));
  }, []);

  // Load chunks when file selected
  const handleSelectFile = useCallback((file: FileItem) => {
    setSelectedFile(file);
    setSearchResults(null);
    setChunksLoading(true);
    api
      .fileChunks(file.id)
      .then(setChunks)
      .catch((e) => setError(e.message))
      .finally(() => setChunksLoading(false));
  }, []);

  // Search
  const handleSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSelectedFile(null);
    api
      .search(q)
      .then((results) => setSearchResults(results))
      .catch((e) => setError(e.message))
      .finally(() => setSearchLoading(false));
  }, [searchQuery]);

  const handleClearSearch = useCallback(() => {
    setSearchResults(null);
    setSearchQuery("");
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-lg font-semibold">Knowledge Explorer</h2>
        <p className="text-sm text-zinc-500 mt-1">
          인덱싱된 파일과 청크를 탐색합니다
        </p>
      </div>

      {/* Content: left panel + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: FileNavigator */}
        <div className="w-72 border-r border-zinc-800 flex-shrink-0 overflow-hidden">
          <FileNavigator
            files={files}
            selectedFileId={selectedFile?.id ?? null}
            onSelectFile={handleSelectFile}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={handleSearch}
          />
        </div>

        {/* Right: DocumentViewer or SearchPanel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {searchResults !== null ? (
            <SearchPanel
              results={searchResults}
              loading={searchLoading}
              query={searchQuery}
              onClear={handleClearSearch}
            />
          ) : (
            <DocumentViewer
              file={selectedFile}
              chunks={chunks}
              loading={chunksLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
