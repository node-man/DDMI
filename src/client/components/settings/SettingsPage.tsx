import { useEffect, useState } from "react";
import { Settings, Cpu } from "lucide-react";
import { api, type ProviderInfo } from "../../lib/client";
import { ProviderCard } from "./ProviderCard";
import { IndexControl } from "./IndexControl";
import { KnowledgeQueryPanel } from "./KnowledgeQueryPanel";

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .providers()
      .then(setProviders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="w-5 h-5 text-zinc-400" />
          Settings
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          AI 프로바이더, 인덱싱, Knowledge Query 관리
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-3xl">
        {/* Providers Section */}
        <section>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-zinc-400" />
            AI Providers
          </h3>
          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-red-400 text-xs mb-3">
              {error}
            </div>
          )}
          {loading ? (
            <p className="text-sm text-zinc-500">Detecting providers...</p>
          ) : providers.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-sm text-zinc-400">
                No AI providers detected. Install{" "}
                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">claude</code>,{" "}
                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">codex</code>,{" "}
                or start{" "}
                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">ollama serve</code>{" "}
                to enable AI features.
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                Level 1 mode: embedding + vector search still works without LLM.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {providers.map((p) => (
                <ProviderCard key={p.name} provider={p} />
              ))}
            </div>
          )}
        </section>

        {/* Indexing Section */}
        <section>
          <IndexControl />
        </section>

        {/* Knowledge Query Section */}
        <section>
          <KnowledgeQueryPanel />
        </section>
      </div>
    </div>
  );
}
