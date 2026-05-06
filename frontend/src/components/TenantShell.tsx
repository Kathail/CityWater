import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout } from "../features/auth/api";
import { ME_QUERY_KEY, useAuth } from "../features/auth/useAuth";
import { ConflictDrawer } from "./ConflictDrawer";
import { OfflineBanner } from "./OfflineBanner";

export function TenantShell() {
  const { user, tenant } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [conflictsOpen, setConflictsOpen] = useState(false);

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      queryClient.removeQueries({ queryKey: ["assets"] });
      queryClient.removeQueries({ queryKey: ["asset-classes"] });
      navigate("/login", { replace: true });
    },
  });

  if (!user || !tenant) return null;

  const slug = tenant.slug;
  const navLink = (to: string, label: string) => (
    <NavLink
      to={to}
      end={to === ""}
      className={({ isActive }) =>
        `block rounded px-3 py-2 text-sm transition-colors ${
          isActive
            ? "bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30"
            : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside className="w-56 border-r border-slate-800 bg-slate-900 p-4 flex flex-col">
        <Link to={`/${slug}/`} className="mb-6 block">
          <h1 className="text-lg font-semibold text-slate-100">{tenant.name}</h1>
          <p className="text-xs text-blue-400">/{slug}</p>
        </Link>
        <nav className="flex flex-col gap-1">
          {navLink(`/${slug}/`, "Home")}
          {navLink(`/${slug}/map`, "Map")}
          {navLink(`/${slug}/assets`, "Assets")}
          {navLink(`/${slug}/work-orders`, "Work orders")}
          {navLink(`/${slug}/inspections`, "Inspections")}
          {navLink(`/${slug}/service-requests`, "Service requests")}
          {navLink(`/${slug}/schedules`, "Schedules")}
          {navLink(`/${slug}/reports`, "Reports")}
          {user.roles.some((r) => r.code === "admin") &&
            navLink(`/${slug}/admin`, "Admin")}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-800">
          <p className="text-xs text-slate-300">{user.full_name}</p>
          <p className="text-xs text-slate-400 truncate">{user.email}</p>
          <button
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="mt-2 w-full rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <main className="flex-1 relative overflow-auto bg-slate-950">
        <OfflineBanner onOpenConflicts={() => setConflictsOpen(true)} />
        <Outlet />
      </main>
      {conflictsOpen && (
        <ConflictDrawer onClose={() => setConflictsOpen(false)} />
      )}
    </div>
  );
}
