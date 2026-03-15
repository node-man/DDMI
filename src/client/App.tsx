import { Sidebar } from "./components/layout/Sidebar";
import { HealthDashboard } from "./components/health/HealthDashboard";

export function App() {
  // Phase 2 Week 1: Health Dashboard만. 추후 라우터 추가.
  const currentPath = "/";

  return (
    <div className="flex h-screen">
      <Sidebar current={currentPath} />
      <main className="flex-1 overflow-auto">
        <HealthDashboard />
      </main>
    </div>
  );
}
