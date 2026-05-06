import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TenantShell } from "./components/TenantShell";
import { AssetDetailPage } from "./features/assets/AssetDetailPage";
import { AssetListPage } from "./features/assets/AssetListPage";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterTenantPage } from "./features/auth/RegisterTenantPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { TenantHomePage } from "./features/auth/TenantHomePage";
import { WorkOrderDetailPage } from "./features/work-orders/WorkOrderDetailPage";
import { WorkOrderListPage } from "./features/work-orders/WorkOrderListPage";

// MapLibre is heavy — lazy-load it so the auth pages stay light.
const MapPage = lazy(() => import("./features/map").then((m) => ({ default: m.MapPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function MapFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-slate-500">
      Loading map…
    </div>
  );
}

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
            <Route path="work-orders" element={<WorkOrderListPage />} />
            <Route path="work-orders/:wo" element={<WorkOrderDetailPage />} />
            <Route
              path="map"
              element={
                <Suspense fallback={<MapFallback />}>
                  <MapPage />
                </Suspense>
              }
            />
          </Route>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
