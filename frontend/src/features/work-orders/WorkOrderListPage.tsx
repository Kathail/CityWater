import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Dash } from "../../components/Dash";
import { RowActions } from "../../components/RowActions";
import { EmptyState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { SummaryBar } from "../../components/SummaryBar";
import { formatDate, formatRelative } from "../../lib/format";
import { translateApiError } from "../../lib/translateApiError";
import { CreateWorkOrderDialog } from "./CreateWorkOrderDialog";
import { KanbanBoard } from "./KanbanBoard";
import {
  transitionWorkOrder,
  type WoCategory,
  type WoPriority,
  type WoStatus,
  type WoType,
  type WorkOrderListParams,
} from "./api";
import { useWorkOrders } from "./hooks";
import {
  canTransition,
  WO_PRIORITY_TONE as PRIORITY_TONE,
  WO_STATUS_TONE as STATUS_TONE,
} from "./tones";

const STATUSES: WoStatus[] = [
  "draft",
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];

/** Statuses that count as "active" for the default filter — anything
 *  that's not done. Drives the Active/All tab. */
const ACTIVE_STATUSES: WoStatus[] = ["open", "assigned", "in_progress", "on_hold"];

/** sessionStorage key the WO detail page reads to build a referrer-
 * preserving "← Back to work orders" link. Saved on every render of
 * the list page so coming back from a detail returns to the same
 * scope/status/q the user was viewing. */
const WO_LIST_REFERRER_KEY = "wo-list-referrer";

export function WorkOrderListPage() {
  const [search, setSearch] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  // Stash the current URL+query so the detail page's back link can
  // restore the operator's filters. Cheap to write on every render.
  useEffect(() => {
    if (!slug) return;
    const qs = search.toString();
    sessionStorage.setItem(WO_LIST_REFERRER_KEY, `/${slug}/work-orders${qs ? `?${qs}` : ""}`);
  }, [slug, search]);

  // Deep-link prefill: another page can navigate here with
  // ?new=1&asset_uid=HYD-00001&title=Inspect+hydrant... and we'll
  // auto-open the create dialog with those defaults. The query
  // params are stripped on dialog close so a refresh doesn't reopen.
  const newDefaults = useMemo(() => {
    if (search.get("new") !== "1") return null;
    return {
      asset_uid: search.get("asset_uid") || undefined,
      title: search.get("title") || undefined,
      category: (search.get("category") as WoCategory) || undefined,
      priority: (search.get("priority") as WoPriority) || undefined,
      type: (search.get("type") as WoType) || undefined,
      description: search.get("description") || undefined,
    };
  }, [search]);

  useEffect(() => {
    if (newDefaults && !createOpen) setCreateOpen(true);
  }, [newDefaults, createOpen]);

  function handleCloseCreate() {
    setCreateOpen(false);
    if (newDefaults) {
      const next = new URLSearchParams(search);
      ["new", "asset_uid", "title", "category", "priority", "type", "description"].forEach((k) =>
        next.delete(k),
      );
      setSearch(next, { replace: true });
    }
  }

  const view = search.get("view") === "kanban" ? "kanban" : "list";
  // Default to Active so supervisors see today's work, not history.
  const scope = (search.get("scope") as "active" | "all" | "mine") ?? "active";
  const overdueOnly = search.get("overdue") === "1";

  // Hand the scope/overdue filters to the backend so the page's `total`
  // matches the dashboard KPIs. Previous client-side filtering only
  // operated on the visible 50-row page, so a tenant with hundreds of
  // WOs saw "47 overdue" on the dashboard and 3 on this page.
  // Explicit ?status= still wins because users can override the scope
  // by picking a single status in the filter dropdown.
  const explicitStatus = (search.get("status") as WoStatus) || undefined;
  const statusIn = !explicitStatus && scope === "active" ? ACTIVE_STATUSES.join(",") : undefined;

  const params: WorkOrderListParams = {
    status: explicitStatus,
    status_in: statusIn,
    overdue: overdueOnly ? "1" : undefined,
    assigned_to: scope === "mine" ? "me" : search.get("assigned_to") || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: view === "kanban" ? 200 : 50,
  };
  const woQuery = useWorkOrders(params);

  // No more client-side scope/overdue filtering — the backend already
  // applied them. visibleItems == server items.
  const visibleItems = useMemo(() => woQuery.data?.items ?? [], [woQuery.data]);

  // Summary stats are scoped to the *current page's items*, which is
  // misleading on tenants with more than `page_size` rows. Drop the
  // client-derived overdue/dueToday/highOrEmergency — only `active`
  // (which equals the page total when scope=active) survives.
  const summary = useMemo(() => {
    const items = woQuery.data?.items ?? [];
    return {
      active: items.filter((w) => ACTIVE_STATUSES.includes(w.status)).length,
    };
  }, [woQuery.data]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearch(next);
  }

  const hasFilters = !!(params.status || params.q || (scope !== "active" && scope !== "all"));

  // Quick-transition mutation — used by the row-actions menu so a
  // supervisor can mark a WO complete or in-progress without
  // navigating into the detail page.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const transition = useMutation<unknown, Error, { wo: string; to: WoStatus }>({
    mutationFn: ({ wo, to }) => transitionWorkOrder(wo, to),
    onSuccess: () => {
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setErrorMessage(translateApiError(e)),
  });

  return (
    <div className="p-4 sm:p-8 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-100">Work orders</h1>
        <div className="flex gap-2">
          <ViewToggle current={view} onChange={(v) => setParam("view", v === "list" ? null : v)} />
          <Button onClick={() => setCreateOpen(true)}>New work order</Button>
        </div>
      </header>

      {/* Summary bar: quick situational read. Counts are scoped to the
          current filter — `Total in dataset` reflects the backend total
          for whatever scope/status is applied, so the dashboard KPIs
          and this view always agree. Per-page-only metrics (Due today,
          High/emergency without a backend filter) were removed because
          they lied on tenants with more rows than fit on one page. */}
      <SummaryBar>
        <SummaryBar.Stat label="Active" value={summary.active} tone="default" to="?scope=active" />
        <SummaryBar.Stat label="On this page" value={visibleItems.length} tone="muted" />
        <SummaryBar.Stat label="Total in dataset" value={woQuery.data?.total ?? 0} tone="muted" />
      </SummaryBar>

      {createOpen && (
        <CreateWorkOrderDialog onClose={handleCloseCreate} defaults={newDefaults ?? undefined} />
      )}

      {errorMessage && <Alert>{errorMessage}</Alert>}

      {view === "list" && (
        <>
          {/* Scope tabs — Active is default to keep the list focused on
              what needs attention. "All" shows the full history. */}
          <ScopeTabs scope={scope} onChange={(s) => setParam("scope", s === "active" ? null : s)} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-slate-300">Status</span>
              <select
                value={params.status ?? ""}
                onChange={(e) => setParam("status", e.target.value || null)}
                className="mt-1 rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
              >
                <option value="">Any</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
                setParam("q", input.value || null);
              }}
              className="block"
            >
              <label className="block">
                <span className="text-xs text-slate-300">Search</span>
                <input
                  name="q"
                  defaultValue={search.get("q") ?? ""}
                  onBlur={(e) => setParam("q", e.target.value || null)}
                  placeholder="WO number, title, asset…"
                  className="mt-1 w-72 rounded border border-slate-700 px-2 py-1 text-sm"
                />
              </label>
            </form>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Priority</th>
                  <th className="px-3 py-2 text-left">Asset</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {woQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                )}
                {visibleItems.length === 0 && !woQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyState
                        title={
                          scope === "active"
                            ? "No active work orders."
                            : hasFilters
                              ? "No work orders match these filters."
                              : "No work orders yet."
                        }
                        hint={
                          scope === "active"
                            ? "Switch to All to see completed/cancelled history, or create a new WO."
                            : hasFilters
                              ? "Try widening filters or switching scope to All."
                              : "Create one from a service request or directly here."
                        }
                        action={
                          hasFilters || scope === "active" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setParam("scope", "all")}
                            >
                              Show all
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => setCreateOpen(true)}>
                              New work order
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
                {visibleItems.map((w) => {
                  const overdue =
                    !!w.due_by &&
                    w.due_by < new Date().toISOString() &&
                    ACTIVE_STATUSES.includes(w.status);
                  return (
                    <tr
                      key={w.wo_number}
                      className={`border-t border-slate-800 transition-colors hover:bg-slate-800/30 ${
                        overdue ? "bg-red-500/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link to={`./${w.wo_number}`} className="text-slate-100 hover:underline">
                          {w.wo_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-100">{w.title}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={STATUS_TONE[w.status]} dot>
                          {w.status.replace("_", " ")}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          tone={PRIORITY_TONE[w.priority]}
                          dot={w.priority === "emergency" || w.priority === "high"}
                        >
                          {w.priority}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{w.asset_uid ?? <Dash />}</td>
                      <td className="px-3 py-2">
                        {w.due_by ? <DueCell iso={w.due_by} overdue={overdue} /> : <Dash />}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RowActions label={`${w.wo_number} actions`}>
                          <RowActions.Link to={`./${w.wo_number}`}>View details</RowActions.Link>
                          {w.asset_uid && (
                            <RowActions.Link to={`/${slug}/assets/${w.asset_uid}`}>
                              View asset
                            </RowActions.Link>
                          )}
                          <RowActions.Separator />
                          {/* Each row action is gated by the shared
                              transition table so the menu never offers
                              a move the backend would 409 (WO-P1-1).
                              Open → assigned (one click), assigned →
                              in_progress, in_progress → completed,
                              every active state → on_hold. */}
                          {canTransition(w.status, "assigned") && (
                            <RowActions.Action
                              onClick={() => transition.mutate({ wo: w.wo_number, to: "assigned" })}
                            >
                              Assign (advance)
                            </RowActions.Action>
                          )}
                          {canTransition(w.status, "in_progress") && (
                            <RowActions.Action
                              onClick={() =>
                                transition.mutate({ wo: w.wo_number, to: "in_progress" })
                              }
                            >
                              Mark in progress
                            </RowActions.Action>
                          )}
                          {canTransition(w.status, "completed") && (
                            <RowActions.Action
                              onClick={() =>
                                transition.mutate({ wo: w.wo_number, to: "completed" })
                              }
                            >
                              Mark complete
                            </RowActions.Action>
                          )}
                          {canTransition(w.status, "on_hold") && (
                            <RowActions.Action
                              onClick={() => transition.mutate({ wo: w.wo_number, to: "on_hold" })}
                            >
                              Put on hold
                            </RowActions.Action>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "kanban" && <KanbanBoard items={woQuery.data?.items ?? []} slug={slug ?? ""} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Due-date cell — relative time + absolute date for unambiguous reading.     */
/* -------------------------------------------------------------------------- */

function DueCell({ iso, overdue }: { iso: string; overdue: boolean }) {
  const date = new Date(iso);
  const ms = date.getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  // "Today" / "Tomorrow" / "in 3d" / "1d overdue" — short and scannable.
  let chip: string;
  if (overdue) {
    const overdueDays = Math.abs(days);
    chip = overdueDays === 0 ? "Due today" : `${overdueDays}d overdue`;
  } else if (days === 0) {
    chip = "Due today";
  } else if (days === 1) {
    chip = "Tomorrow";
  } else if (days <= 7) {
    chip = `in ${days}d`;
  } else {
    chip = formatRelative(iso);
  }
  return (
    <div className="leading-tight">
      <p className={`text-xs ${overdue ? "text-red-300 font-medium" : "text-slate-200"}`}>{chip}</p>
      <p className="text-[10px] text-slate-500">{formatDate(iso)}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Active / All / Mine scope tabs.                                            */
/* -------------------------------------------------------------------------- */

function ScopeTabs({
  scope,
  onChange,
}: {
  scope: "active" | "all" | "mine";
  onChange: (s: "active" | "all" | "mine") => void;
}) {
  const tabs: { key: "active" | "all" | "mine"; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "mine", label: "Mine" },
    { key: "all", label: "All" },
  ];
  return (
    <div
      role="tablist"
      className="inline-flex rounded border border-slate-700 bg-slate-950/40 p-0.5"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={scope === t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`rounded px-3 py-1 text-xs transition-colors ${
            scope === t.key ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* List vs Kanban view toggle.                                                */
/* -------------------------------------------------------------------------- */

function ViewToggle({
  current,
  onChange,
}: {
  current: "list" | "kanban";
  onChange: (v: "list" | "kanban") => void;
}) {
  return (
    <div className="inline-flex rounded border border-slate-700 bg-slate-950/40 p-0.5">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`rounded px-2.5 py-1 text-xs transition-colors ${
          current === "list" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-100"
        }`}
      >
        List
      </button>
      <button
        type="button"
        onClick={() => onChange("kanban")}
        className={`rounded px-2.5 py-1 text-xs transition-colors ${
          current === "kanban" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-100"
        }`}
      >
        Kanban
      </button>
    </div>
  );
}
