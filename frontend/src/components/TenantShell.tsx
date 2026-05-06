import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout } from "../features/auth/api";
import { ME_QUERY_KEY, useAuth } from "../features/auth/useAuth";

export function TenantShell() {
  const { user, tenant } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
        `block rounded px-3 py-2 text-sm ${
          isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-56 border-r border-slate-200 bg-white p-4 flex flex-col">
        <Link to={`/${slug}/`} className="mb-6 block">
          <h1 className="text-lg font-semibold text-slate-900">{tenant.name}</h1>
          <p className="text-xs text-slate-500">/{slug}</p>
        </Link>
        <nav className="flex flex-col gap-1">
          {navLink(`/${slug}/`, "Home")}
          {navLink(`/${slug}/map`, "Map")}
          {navLink(`/${slug}/assets`, "Assets")}
          {navLink(`/${slug}/work-orders`, "Work orders")}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-600">{user.full_name}</p>
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
          <button
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <main className="flex-1 relative overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
