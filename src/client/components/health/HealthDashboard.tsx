import { useEffect, useState } from "react";
import {
  FileText,
  Blocks,
  GitBranch,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { api, type HealthData } from "../../lib/client";
import { StatCard } from "./StatCard";
import { HealthGauge } from "./HealthGauge";

export function HealthDashboard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setData)
      .catch((e) => setError(e.message));
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

  if (!data) {
    return <div className="p-6 text-zinc-500">Loading...</div>;
  }

  const hasConflicts = data.openConflicts > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Project Health</h2>
        <p className="text-sm text-zinc-500 mt-1">
          프로젝트 지식 인프라 상태
        </p>
      </div>

      {/* Top: Gauge + Chain status */}
      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Gauge */}
        <div className="flex-shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <HealthGauge
            openConflicts={data.openConflicts}
            relations={data.relations}
          />
        </div>

        {/* Chain status badge + summary */}
        <div className="flex-1 space-y-4">
          {/* Chain badge */}
          <div
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
              data.chainValid
                ? "bg-green-950/40 text-green-400 border border-green-800/50"
                : "bg-red-950/40 text-red-400 border border-red-800/50"
            }`}
          >
            {data.chainValid ? (
              <ShieldCheck className="w-4 h-4" />
            ) : (
              <ShieldAlert className="w-4 h-4" />
            )}
            Audit Chain:{" "}
            {data.chainValid ? "Verified" : "Integrity Failure"}
            <span className="text-xs opacity-60 ml-1">
              ({data.chainChecked} checked)
            </span>
          </div>

          {/* Quick summary */}
          <div className="text-sm text-zinc-400 space-y-1">
            <p>
              <span className="text-zinc-200 font-medium">{data.files}</span>{" "}
              files indexed into{" "}
              <span className="text-zinc-200 font-medium">
                {data.chunks.toLocaleString()}
              </span>{" "}
              chunks
            </p>
            <p>
              <span className="text-zinc-200 font-medium">
                {data.relations}
              </span>{" "}
              relations tracked,{" "}
              <span
                className={
                  hasConflicts
                    ? "text-yellow-400 font-medium"
                    : "text-zinc-200 font-medium"
                }
              >
                {data.openConflicts}
              </span>{" "}
              open conflicts
            </p>
          </div>
        </div>
      </div>

      {/* Middle: StatCards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Files"
          value={data.files}
          icon={<FileText className="w-4 h-4" />}
        />
        <StatCard
          label="Chunks"
          value={data.chunks.toLocaleString()}
          icon={<Blocks className="w-4 h-4" />}
        />
        <StatCard
          label="Relations"
          value={data.relations}
          icon={<GitBranch className="w-4 h-4" />}
        />
        <StatCard
          label="Conflicts"
          value={data.openConflicts}
          icon={<AlertTriangle className="w-4 h-4" />}
          status={hasConflicts ? "warn" : "ok"}
        />
        <StatCard label="Audit" value={data.auditEvents} />
        <StatCard
          label="Chain"
          value={data.chainValid ? "Valid" : "Broken"}
          icon={
            data.chainValid ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )
          }
          status={data.chainValid ? "ok" : "error"}
        />
      </div>

      {/* Bottom: Warnings */}
      {hasConflicts && (
        <div className="rounded-lg border border-yellow-700/40 bg-yellow-950/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-400">
              Open Conflicts ({data.openConflicts})
            </span>
          </div>
          <p className="text-xs text-yellow-500/80">
            프로젝트에 해결되지 않은 충돌이 있습니다. Conflicts 페이지에서
            확인하세요.
          </p>
        </div>
      )}
    </div>
  );
}
