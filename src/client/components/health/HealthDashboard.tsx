import { useEffect, useState } from "react";
import { FileText, Blocks, GitBranch, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { api, type HealthData } from "../../lib/client";
import { StatCard } from "./StatCard";

export function HealthDashboard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health()
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
    return (
      <div className="p-6 text-zinc-500">Loading...</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Project Health</h2>
        <p className="text-sm text-zinc-500 mt-1">프로젝트 지식 인프라 상태</p>
      </div>

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
          status={data.openConflicts > 0 ? "warn" : "ok"}
        />
        <StatCard
          label="Audit"
          value={data.auditEvents}
        />
        <StatCard
          label="Chain"
          value={data.chainValid ? "Valid" : "Broken"}
          icon={data.chainValid
            ? <CheckCircle className="w-4 h-4 text-green-500" />
            : <XCircle className="w-4 h-4 text-red-500" />}
          status={data.chainValid ? "ok" : "error"}
        />
      </div>
    </div>
  );
}
