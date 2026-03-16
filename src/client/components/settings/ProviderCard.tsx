import { Terminal, Server } from "lucide-react";
import type { ProviderInfo } from "../../lib/client";

interface Props {
  provider: ProviderInfo;
}

export function ProviderCard({ provider }: Props) {
  const isOllama = provider.type === "ollama";
  const Icon = isOllama ? Server : Terminal;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">{provider.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              provider.status === "available" ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span
            className={`text-[11px] font-medium ${
              provider.status === "available" ? "text-green-400" : "text-red-400"
            }`}
          >
            {provider.status}
          </span>
        </div>
      </div>

      <span
        className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wide ${
          isOllama
            ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
            : "bg-blue-500/20 text-blue-400 border-blue-500/30"
        }`}
      >
        {provider.type}
      </span>

      {isOllama && provider.models && provider.models.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide font-medium">Models</p>
          <div className="flex flex-wrap gap-1.5">
            {provider.models.map((model) => (
              <span
                key={model}
                className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
              >
                {model}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
