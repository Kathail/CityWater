import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TenantShell } from "./components/TenantShell";
import { AssetDetailPage } from "./features/assets/AssetDetailPage";
import { AssetListPage } from "./features/assets/AssetListPage";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterTenantPage } from "./features/auth/RegisterTenantPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { TenantHomePage } from "./features/auth/TenantHomePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterTenantPage />} />
          <Route
            path="/:slug"
            element={
              <RequireAuth>
                <TenantShell />
              </RequireAuth>
            }
          >
            <Route index element={<TenantHomePage />} />
            <Route path="assets" element={<AssetListPage />} />
            <Route path="assets/:uid" element={<AssetDetailPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
