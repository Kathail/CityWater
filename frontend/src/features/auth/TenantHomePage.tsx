import { Link } from "react-router-dom";
import { useAuth } from "./useAuth";

export function TenantHomePage() {
  const { user, tenant } = useAuth();
  if (!user || !tenant) return null;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome, {user.full_name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in to {tenant.name} ({tenant.slug})
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Quick links</h2>
        <ul className="mt-3 space-y-2">
          <li>
            <Link to={`/${tenant.slug}/map`} className="text-slate-900 hover:underline">
              Open the map →
            </Link>
          </li>
          <li>
            <Link to={`/${tenant.slug}/assets`} className="text-slate-900 hover:underline">
              Browse the asset list →
            </Link>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Your roles</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <li key={r.code} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {r.name}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-slate-500">
        Work orders, inspections, and service requests land in upcoming sprints (S5+).
      </p>
    </div>
  );
}
