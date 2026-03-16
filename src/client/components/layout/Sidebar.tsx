import { Link } from "react-router-dom";
import { BarChart3, GitBranch, Shield, Clock, Activity, Settings } from "lucide-react";

const nav = [
  { name: "Health", path: "/", icon: Activity },
  { name: "Explorer", path: "/explorer", icon: BarChart3 },
  { name: "Graph", path: "/graph", icon: GitBranch },
  { name: "Conflicts", path: "/conflicts", icon: Shield },
  { name: "Audit", path: "/audit", icon: Clock },
  { name: "Settings", path: "/settings", icon: Settings },
];

export function Sidebar({ current }: { current: string }) {
  return (
    <aside className="w-56 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="px-4 py-5 border-b border-zinc-800">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-blue-400">ddmi</span>
          <span className="text-zinc-500 text-sm ml-2">Mission Control</span>
        </h1>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {nav.map(({ name, path, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              current === path
                ? "bg-zinc-800 text-zinc-100 font-medium"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <Icon className="w-4 h-4" />
            {name}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-600">
        v0.2.5 · Phase 2.5
      </div>
    </aside>
  );
}
