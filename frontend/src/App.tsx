import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router-dom";
import { TenantShell } from "./components/TenantShell";
import { AcceptInvitationPage } from "./features/admin/AcceptInvitationPage";
import { AdminAssetClassesPage } from "./features/admin/AdminAssetClassesPage";
import { AdminInvitationsPage } from "./features/admin/AdminInvitationsPage";
import { AdminLayout } from "./features/admin/AdminLayout";
import { AdminTenantPage } from "./features/admin/AdminTenantPage";
import { AdminUsersPage } from "./features/admin/AdminUsersPage";
import { AssetDetailPage } from "./features/assets/AssetDetailPage";
import { AssetListPage } from "./features/assets/AssetListPage";
import { DemoLoginPage } from "./features/auth/DemoLoginPage";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterTenantPage } from "./features/auth/RegisterTenantPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { TenantHomePage } from "./features/auth/TenantHomePage";
import { InspectionDetailPage } from "./features/inspections/InspectionDetailPage";
import { InspectionListPage } from "./features/inspections/InspectionListPage";
import { ReportDetailPage } from "./features/reports/ReportDetailPage";
import { ReportsPage } from "./features/reports/ReportsPage";
import { SchedulesPage } from "./features/schedules/SchedulesPage";
import { TaskCatalog } from "./features/tasks/TaskCatalog";
import { ServiceRequestDetailPage } from "./features/service-requests/ServiceRequestDetailPage";
import { ServiceRequestListPage } from "./features/service-requests/ServiceRequestListPage";
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

// Data router (v6.4+). Required for `useBlocker` (used by
// <UnsavedChangesGuard>); also opts into the v7 behaviour flags so
// future upgrades are noisy in dev, not silent in prod.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/demo" element={<DemoLoginPage />} />
      <Route path="/register" element={<RegisterTenantPage />} />
      <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />
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
        <Route path="inspections" element={<InspectionListPage />} />
        <Route path="inspections/:n" element={<InspectionDetailPage />} />
        <Route path="service-requests" element={<ServiceRequestListPage />} />
        <Route path="service-requests/:sr" element={<ServiceRequestDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:reportSlug" element={<ReportDetailPage />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminUsersPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="invitations" element={<AdminInvitationsPage />} />
          <Route path="tenant" element={<AdminTenantPage />} />
          <Route path="asset-classes" element={<AdminAssetClassesPage />} />
          <Route path="task-definitions" element={<TaskCatalog />} />
        </Route>
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
    </>,
  ),
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>
  );
}
