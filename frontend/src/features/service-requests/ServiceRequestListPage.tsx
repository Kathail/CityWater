import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { IntakeDialog } from "./IntakeDialog";
import type {
  ServiceRequestListParams,
  SrCategory,
  SrDomain,
  SrStatus,
} from "./api";
import { useServiceRequests } from "./hooks";

const STATUSES: SrStatus[] = ["new", "triaged", "dispatched", "closed", "duplicate"];
const DOMAINS: SrDomain[] = ["water", "sewer", "storm"];
const CATEGORIES: SrCategory[] = [
  "low_pressure",
  "no_water",
  "sewer_backup",
  "flooding",
  "odour",
  "damaged_asset",
  "other",
];

export function ServiceRequestListPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const [intakeOpen, setIntakeOpen] = useState(false);

  const params: ServiceRequestListParams = {
    status: (search.get("status") as SrStatus) || undefined,
    category: (search.get("category") as SrCategory) || undefined,
    domain: (search.get("domain") as SrDomain) || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: 50,
  };

  const query = useServiceRequests(params);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearch(next);
  }

  return (
    <div className="p-8 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Service requests</h1>
        <button
          onClick={() => setIntakeOpen(true)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          New intake
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block text-slate-600">Status</span>
          <select
            value={params.status ?? ""}
            onChange={(e) => setParam("status", e.target.value || null)}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate-600">Domain</span>
          <select
            value={params.domain ?? ""}
            onChange={(e) => setParam("domain", e.target.value || null)}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Any</option>
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate-600">Category</span>
          <select
            value={params.category ?? ""}
            onChange={(e) => setParam("category", e.target.value || null)}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 max-w-xs">
          <span className="block text-slate-600">Search</span>
          <input
            value={params.q ?? ""}
            onChange={(e) => setParam("q", e.target.value || null)}
            placeholder="number, caller, address, description"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Caller</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Reported</th>
              <th className="px-3 py-2">WO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {query.data?.items.map((sr) => (
              <tr key={sr.sr_number} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">
                  <Link
                    to={`/${slug}/service-requests/${sr.sr_number}`}
                    className="text-slate-900 hover:underline"
                  >
                    {sr.sr_number}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={sr.status} />
                </td>
                <td className="px-3 py-2">{sr.category}</td>
                <td className="px-3 py-2">{sr.domain}</td>
                <td className="px-3 py-2">{sr.priority}</td>
                <td className="px-3 py-2">{sr.caller_name ?? "—"}</td>
                <td className="px-3 py-2 max-w-xs truncate">{sr.address ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(sr.reported_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {sr.work_order_number ? (
                    <Link
                      to={`/${slug}/work-orders/${sr.work_order_number}`}
                      className="text-slate-700 hover:underline"
                    >
                      {sr.work_order_number}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {query.data && query.data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-slate-500">
                  No service requests match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {intakeOpen && <IntakeDialog onClose={() => setIntakeOpen(false)} />}
    </div>
  );
}

function StatusPill({ status }: { status: SrStatus }) {
  const cls: Record<SrStatus, string> = {
    new: "bg-blue-100 text-blue-800",
    triaged: "bg-amber-100 text-amber-800",
    dispatched: "bg-violet-100 text-violet-800",
    closed: "bg-slate-200 text-slate-700",
    duplicate: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls[status]}`}>
      {status}
    </span>
  );
}
