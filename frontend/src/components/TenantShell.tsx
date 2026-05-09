import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { logout } from "../features/auth/api";
import { useAuth } from "../features/auth/useAuth";
import { type DashboardResponse, getDashboard } from "../features/dashboard/api";
import { AppFooter } from "./AppFooter";
import { ConflictDrawer } from "./ConflictDrawer";
import { DemoBanner } from "./DemoBanner";
import { Logo } from "./Logo";
import { OfflineBanner } from "./OfflineBanner";

/**
 * App shell for an authenticated tenant.
 *
 * Responsive layout:
 *  - ≥ md (768px): fixed left sidebar (224px) + outlet column.
 *  - < md: top bar with hamburger + logo; nav slides in as a sheet
 *    from the left over a backdrop. Closing on Esc, on backdrop tap,
 *    and on every route change so a tap-to-navigate doesn't leave
 *    the drawer open over the page.
 */
export function TenantShell() {
  const { user, tenant } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Live count badges for the nav. Reuses the dashboard's payload —
  // already polled every 60s for the home page, so the cache hit is
  // free everywhere else. `enabled: !!user` keeps this query from
  // firing before the auth state resolves (and before the early
  // return below), which would otherwise trip
  // react-hooks/rules-of-hooks.
  const dash = useQuery<DashboardResponse, Error>({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    enabled: !!user && !!tenant,
  });

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Clear *every* query so signing into a different tenant doesn't
      // briefly show stale data from the previous one.
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  // Close the mobile drawer whenever the route changes — otherwise a
  // tap on a nav link leaves the sheet hovering over the new page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  if (!user || !tenant) return null;

  const slug = tenant.slug;
  const isDemo = tenant.slug === "demo";

  // If the URL slug doesn't match the session tenant, redirect to the
  // session's tenant home rather than rendering chrome that lies about
  // the active tenant. CLAUDE.md: tenant scope is derived from the
  // authenticated session, never the URL.
  const urlSlug = (params as { slug?: string }).slug;
  if (urlSlug && urlSlug !== slug) {
    return <Navigate to={`/${slug}/`} replace />;
  }
  const isAdmin = user.roles.some((r) => r.code === "admin");

  const woOpen = dash.data?.wo_kpis.open ?? null;
  const srNew = dash.data?.sr_kpis.new ?? null;

  // Operations-console nav: signal-cyan rail on active, monospace
  // section labels for grouping. Tighter padding than before so more
  // links fit without scroll on small screens.
  const navLink = (to: string, label: string, count: number | null = null) => (
    <NavLink
      to={to}
      end={to === `/${slug}/`}
      className={({ isActive }) =>
        `relative flex items-center gap-2 rounded-sm px-3 py-1 text-[13px] transition-colors ${
          isActive
            ? "bg-signal/10 text-signal"
            : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-signal"
            />
          )}
          <span className="flex-1">{label}</span>
          {count !== null && count > 0 && (
            <span
              className={`font-mono text-[10px] tabular-nums ${
                isActive ? "text-signal/80" : "text-slate-500"
              }`}
            >
              {count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  // Sidebar body — the same content is mounted in two places (mobile
  // drawer + desktop fixed sidebar) so we extract it. Three groups:
  //
  //  · Operations — daily-use stuff: dashboard, the live map, the
  //    queues that drive the day (work orders / service requests /
  //    inspections / assets).
  //  · Plan       — lower-frequency planning + analysis: schedules
  //    and reports.
  //  · Admin      — settings (role-gated).
  //
  // User identity + sign-out used to live at the bottom of the
  // sidebar; both moved into <AppFooter> so the sidebar is just nav.
  // Tenant name + slug at the top now opens a small <TenantMenu>
  // dropdown instead of being a plain home link — keeps "switch
  // tenant / settings / sign out" reachable without crowding the nav.
  const sidebarBody = (
    <>
      <TenantMenu
        tenant={tenant}
        slug={slug}
        isAdmin={isAdmin}
        signOut={() => signOut.mutate()}
        signOutPending={signOut.isPending}
      />

      <p className="section-label mb-1.5 mt-4 px-3">Operations</p>
      <nav className="flex flex-col gap-0">
        {navLink(`/${slug}/`, "Home")}
        {navLink(`/${slug}/map`, "Map")}
        {navLink(`/${slug}/work-orders`, "Work orders", woOpen)}
        {navLink(`/${slug}/service-requests`, "Service requests", srNew)}
        {navLink(`/${slug}/inspections`, "Inspections")}
        {navLink(`/${slug}/assets`, "Assets")}
      </nav>

      <p className="section-label mb-1.5 mt-4 px-3">Plan</p>
      <nav className="flex flex-col gap-0">
        {navLink(`/${slug}/schedules`, "Schedules")}
        {navLink(`/${slug}/reports`, "Reports")}
      </nav>

      {isAdmin && (
        <>
          <p className="section-label mb-1.5 mt-4 px-3">Admin</p>
          <nav className="flex flex-col gap-0">{navLink(`/${slug}/admin`, "Settings")}</nav>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {isDemo && <DemoBanner />}

      {/* Mobile top bar — only visible below md breakpoint. */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          className="rounded p-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link to={`/${slug}/`} className="flex min-w-0 items-center gap-2">
          <Logo size={26} className="shrink-0" />
          <span className="truncate text-sm font-semibold text-slate-100">{tenant.name}</span>
        </Link>
        <div className="w-8" aria-hidden="true" />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4 md:flex">
          {sidebarBody}
        </aside>

        {/* Mobile drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-900 p-4 shadow-2xl">
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                className="mb-2 self-end rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
              {sidebarBody}
            </aside>
          </div>
        )}

        <main className="relative flex-1 overflow-auto bg-slate-950">
          <OfflineBanner onOpenConflicts={() => setConflictsOpen(true)} />
          <Outlet />
        </main>
      </div>

      <AppFooter user={user} tenant={tenant} />

      {conflictsOpen && <ConflictDrawer onClose={() => setConflictsOpen(false)} />}
    </div>
  );
}

/**
 * Tenant header at the top of the sidebar. Click → opens a small
 * dropdown with the tenant name (read-only — multi-tenant per user
 * isn't a feature today, so no actual switcher), a Settings link
 * (admin only), and Sign out.
 *
 * This replaces the previous plain-Link header that double-acted as
 * the home shortcut. Home moved into the Operations nav group below
 * so it's surfaced as an explicit option.
 */
function TenantMenu({
  tenant,
  slug,
  isAdmin,
  signOut,
  signOutPending,
}: {
  tenant: { name: string; slug: string };
  slug: string;
  isAdmin: boolean;
  signOut: () => void;
  signOutPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (!tgt?.closest?.("[data-tenant-menu]")) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="relative" data-tenant-menu>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded border border-transparent px-2 py-2 text-left transition-colors ${
          open ? "border-slate-800 bg-slate-900" : "hover:bg-slate-900"
        }`}
        title={tenant.name}
      >
        <Logo size={28} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-1 break-words text-[13px] font-semibold leading-tight text-slate-100">
            {tenant.name}
          </h1>
          <p className="section-label-signal">/{slug}</p>
        </div>
        <svg
          aria-hidden
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60"
        >
          <div className="border-b border-dashed border-slate-800 px-3 py-2">
            <p className="section-label">Tenant</p>
            <p className="text-[12px] text-slate-200 truncate">{tenant.name}</p>
          </div>
          {isAdmin && (
            <Link
              to={`/${slug}/admin`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            >
              Settings
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            role="menuitem"
            disabled={signOutPending}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-300 hover:bg-slate-900 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {signOutPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
