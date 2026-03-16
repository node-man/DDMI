import { useState } from "react";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { api } from "../../lib/client";

export function KnowledgeQueryPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!question.trim() || loading) return;

    setLoading(true);
    setError(null);
    setAnswer(null);

    try {
      const result = await api.knowledgeQuery(question.trim());
      setAnswer(result.answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <h3 className="text-sm font-medium text-zinc-200 mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-zinc-400" />
        Knowledge Query
      </h3>
      <p className="text-[11px] text-zinc-500 mb-3">
        Ask a natural language question about your project documents. Requires LLM provider (Level 2).
      </p>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g., What caching strategy was decided in ADR-007?"
        rows={3}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200
          placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 resize-none"
      />

      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-zinc-600">Cmd+Enter to submit</span>
        <button
          onClick={handleSubmit}
          disabled={!question.trim() || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
            bg-blue-900/40 text-blue-300 border border-blue-700/50
            hover:bg-blue-800/40 hover:text-blue-200 hover:border-blue-600/50
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {loading ? "Querying..." : "Submit"}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-xs text-red-400 bg-red-950/30 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {answer && (
        <div className="mt-3">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide font-medium mb-1">
            Answer
          </p>
          <div className="bg-zinc-950 border border-zinc-700 rounded-md p-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {answer}
          </div>
        </div>
      )}
    </div>
  );
}
