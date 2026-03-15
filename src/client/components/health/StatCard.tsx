interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  status?: "ok" | "warn" | "error";
}

export function StatCard({ label, value, icon, status = "ok" }: StatCardProps) {
  const borderColor = {
    ok: "border-zinc-800",
    warn: "border-yellow-600/50",
    error: "border-red-600/50",
  }[status];

  return (
    <div className={`rounded-lg border ${borderColor} bg-zinc-900/50 p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        {icon && <span className="text-zinc-600">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}
