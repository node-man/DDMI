import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { HealthDashboard } from "./components/health/HealthDashboard";
import { ExplorerPage } from "./components/explorer/ExplorerPage";
import { GraphPage } from "./components/graph/GraphPage";
import { ConflictsPage } from "./components/conflicts/ConflictsPage";
import { AuditPage } from "./components/audit/AuditPage";
import { SettingsPage } from "./components/settings/SettingsPage";

function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen">
      <Sidebar current={pathname} />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<HealthDashboard />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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
