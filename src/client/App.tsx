import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { HealthDashboard } from "./components/health/HealthDashboard";
import { ExplorerPage } from "./components/explorer/ExplorerPage";

// Phase 2 Week 3-6에서 구현 예정
function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold">{name}</h2>
      <p className="text-sm text-zinc-500 mt-2">Coming in Phase 2</p>
    </div>
  );
}

function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen">
      <Sidebar current={pathname} />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<HealthDashboard />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/graph" element={<PlaceholderPage name="Knowledge Graph" />} />
          <Route path="/conflicts" element={<PlaceholderPage name="Conflict Studio" />} />
          <Route path="/audit" element={<PlaceholderPage name="Audit Timeline" />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
