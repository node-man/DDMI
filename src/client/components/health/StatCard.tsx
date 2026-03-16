interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  status?: "ok" | "warn" | "error";
}

export function StatCard({ label, value, icon, status = "ok" }: StatCardProps) {
  const borderColor = {
    ok: "border-zinc-800 hover:border-zinc-700",
    warn: "border-yellow-600/50 hover:border-yellow-500/60",
    error: "border-red-600/50 hover:border-red-500/60",
  }[status];

  const glowClass = {
    ok: "",
    warn: "hover:shadow-yellow-900/20",
    error: "hover:shadow-red-900/20",
  }[status];

  return (
    <div
      className={`rounded-lg border ${borderColor} bg-zinc-900/50 p-4 transition-all duration-200 hover:bg-zinc-900/80 hover:shadow-lg ${glowClass}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <span className="text-zinc-600 transition-colors duration-200 group-hover:text-zinc-400">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
