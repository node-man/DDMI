import {
  FilePlus,
  FileEdit,
  AlertTriangle,
  CheckCircle,
  Scale,
  Layers,
} from "lucide-react";
import type { AuditEvent } from "../../lib/client";

// eventType -> color class (dot + badge)
const EVENT_COLORS: Record<string, string> = {
  file_created: "bg-green-400",
  file_modified: "bg-blue-400",
  conflict_detected: "bg-red-400",
  conflict_resolved: "bg-yellow-400",
  decision_made: "bg-purple-400",
  context_assembled: "bg-zinc-400",
};

// eventType -> badge text color
const BADGE_STYLES: Record<string, string> = {
  file_created: "bg-green-950/60 text-green-400 border-green-800/50",
  file_modified: "bg-blue-950/60 text-blue-400 border-blue-800/50",
  conflict_detected: "bg-red-950/60 text-red-400 border-red-800/50",
  conflict_resolved: "bg-yellow-950/60 text-yellow-400 border-yellow-800/50",
  decision_made: "bg-purple-950/60 text-purple-400 border-purple-800/50",
  context_assembled: "bg-zinc-800/60 text-zinc-400 border-zinc-700/50",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  file_created: <FilePlus className="w-4 h-4" />,
  file_modified: <FileEdit className="w-4 h-4" />,
  conflict_detected: <AlertTriangle className="w-4 h-4" />,
  conflict_resolved: <CheckCircle className="w-4 h-4" />,
  decision_made: <Scale className="w-4 h-4" />,
  context_assembled: <Layers className="w-4 h-4" />,
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  // Less than 1 hour: relative
  if (diff < 3600_000) {
    const mins = Math.floor(diff / 60_000);
    return mins <= 0 ? "just now" : `${mins}m ago`;
  }

  // Same day: show time only
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // Otherwise: date + time
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  events: AuditEvent[];
}

export function AuditTimeline({ events }: Props) {
  return (
    <div className="relative max-w-2xl">
      {events.map((event, idx) => {
        const color = EVENT_COLORS[event.eventType] ?? "bg-zinc-500";
        const badgeStyle = BADGE_STYLES[event.eventType] ?? "bg-zinc-800/60 text-zinc-400 border-zinc-700/50";
        const icon = EVENT_ICONS[event.eventType];
        const isLast = idx === events.length - 1;

        return (
          <div key={event.id} className="relative flex gap-4">
            {/* Left column: dot + vertical line */}
            <div className="flex flex-col items-center flex-shrink-0 w-8">
              {/* Dot */}
              <div
                className={`w-3 h-3 rounded-full mt-5 ring-4 ring-zinc-950 ${color}`}
              />
              {/* Vertical line */}
              {!isLast && (
                <div className="w-px flex-1 bg-zinc-800" />
              )}
            </div>

            {/* Right column: card */}
            <div className="pb-6 flex-1 min-w-0">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                {/* Top row: badge + time */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${badgeStyle}`}
                  >
                    {icon}
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-zinc-500 flex-shrink-0">
                    {formatTime(event.timestamp)}
                  </span>
                </div>

                {/* Actor */}
                <p className="text-sm text-zinc-300">
                  <span className="text-zinc-500">by</span>{" "}
                  <span className="font-medium">{event.actor}</span>
                </p>

                {/* Target file */}
                {event.targetFile && (
                  <p className="text-xs text-zinc-500 mt-1 font-mono truncate">
                    {event.targetFile}
                  </p>
                )}

                {/* Rationale */}
                {event.rationale && (
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed border-l-2 border-zinc-700 pl-3">
                    {event.rationale}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
