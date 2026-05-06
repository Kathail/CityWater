import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CreateWorkOrderDialog } from "./CreateWorkOrderDialog";
import { KanbanBoard } from "./KanbanBoard";
import { type WoStatus, type WorkOrderListParams } from "./api";
import { useWorkOrders } from "./hooks";

const STATUSES: WoStatus[] = [
  "draft",
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];

export function WorkOrderListPage() {
  const [search, setSearch] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const { slug } = useParams<{ slug: string }>();

  const view = search.get("view") === "kanban" ? "kanban" : "list";

  const params: WorkOrderListParams = {
    status: (search.get("status") as WoStatus) || undefined,
    assigned_to: search.get("assigned_to") || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: view === "kanban" ? 200 : 50,
  };
  const woQuery = useWorkOrders(params);

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
        <h1 className="text-2xl font-semibold text-slate-900">Work orders</h1>
        <div className="flex gap-2">
          <div className="rounded border border-slate-300 bg-white p-0.5 flex">
            <button
              onClick={() => setParam("view", null)}
              className={`px-2.5 py-1 text-xs rounded ${
                view === "list" ? "bg-slate-900 text-white" : "text-slate-700"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setParam("view", "kanban")}
              className={`px-2.5 py-1 text-xs rounded ${
                view === "kanban" ? "bg-slate-900 text-white" : "text-slate-700"
              }`}
            >
              Kanban
            </button>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            New work order
          </button>
        </div>
      </header>

      {createOpen && <CreateWorkOrderDialog onClose={() => setCreateOpen(false)} />}

      {view === "list" && (
        <>
          <div className="flex gap-3 items-end flex-wrap">
            <label className="block">
              <span className="text-xs text-slate-600">Status</span>
              <select
                value={params.status ?? ""}
                onChange={(e) => setParam("status", e.target.value || null)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm bg-white"
              >
                <option value="">Any</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 text-sm pb-1">
              <input
                type="checkbox"
                checked={search.get("assigned_to") === "me"}
                onChange={(e) => setParam("assigned_to", e.target.checked ? "me" : null)}
              />
              <span>Assigned to me</span>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Search</span>
              <input
                defaultValue={search.get("q") ?? ""}
                onBlur={(e) => setParam("q", e.target.value || null)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm w-64"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Priority</th>
                  <th className="px-3 py-2 text-left">Asset</th>
                  <th className="px-3 py-2 text-left">Due</th>
                </tr>
              </thead>
              <tbody>
                {woQuery.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                )}
                {woQuery.data?.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No work orders match these filters.
                    </td>
                  </tr>
                )}
                {woQuery.data?.items.map((w) => (
                  <tr key={w.wo_number} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link to={`./${w.wo_number}`} className="text-slate-900 hover:underline">
                        {w.wo_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{w.title}</td>
                    <td className="px-3 py-2">{w.status}</td>
                    <td className="px-3 py-2">{w.priority}</td>
                    <td className="px-3 py-2 font-mono text-xs">{w.asset_uid ?? "—"}</td>
                    <td className="px-3 py-2">{w.due_by?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "kanban" && <KanbanBoard items={woQuery.data?.items ?? []} slug={slug ?? ""} />}
    </div>
  );
}
