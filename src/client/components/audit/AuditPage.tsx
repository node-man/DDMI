import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Inbox } from "lucide-react";
import { api, type AuditEvent } from "../../lib/client";
import { AuditTimeline } from "./AuditTimeline";

const EVENT_TYPES = [
  { value: "", label: "All types" },
  { value: "file_created", label: "File Created" },
  { value: "file_modified", label: "File Modified" },
  { value: "conflict_detected", label: "Conflict Detected" },
  { value: "conflict_resolved", label: "Conflict Resolved" },
  { value: "decision_made", label: "Decision Made" },
  { value: "context_assembled", label: "Context Assembled" },
];

const LIMIT_OPTIONS = [20, 50, 100, 200];

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [limit, setLimit] = useState(50);

  const loadEvents = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .audit(limit, typeFilter || undefined)
      .then(setEvents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [limit, typeFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-indigo-400" />
          Audit Timeline
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          프로젝트 변경 이력을 추적합니다
        </p>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </select>

          {/* Event count */}
          {!loading && (
            <span className="text-sm text-zinc-500">
              <span className="text-zinc-300 font-medium">{events.length}</span>{" "}
              event{events.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-zinc-500 text-sm">Loading audit events...</div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-zinc-600/30" />
              <p className="text-sm text-zinc-400 font-medium">
                No audit events
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                Changes made through mutate_audited will appear here.
              </p>
            </div>
          </div>
        ) : (
          <AuditTimeline events={events} />
        )}
      </div>
    </div>
  );
}
