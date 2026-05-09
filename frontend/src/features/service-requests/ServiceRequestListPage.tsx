import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/PageHeader";
import { Dash } from "../../components/Dash";
import { RowActions } from "../../components/RowActions";
import { EmptyState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { SummaryBar } from "../../components/SummaryBar";
import { showToast } from "../../lib/toast";
import { formatDateTime } from "../../lib/format";
import { translateApiError } from "../../lib/translateApiError";
import { IntakeDialog } from "./IntakeDialog";
import {
  updateServiceRequest,
  type ServiceRequestListParams,
  type SrCategory,
  type SrDomain,
  type SrPriority,
  type SrStatus,
} from "./api";
import { useServiceRequests } from "./hooks";
import { SR_PRIORITY_TONE as PRIORITY_TONE, SR_STATUS_TONE as STATUS_TONE } from "./tones";

const STATUSES: SrStatus[] = ["new", "triaged", "dispatched", "closed", "duplicate"];
const DOMAINS: SrDomain[] = ["water", "sewer", "storm"];
const CATEGORIES: SrCategory[] = [
  "low_pressure",
  "no_water",
  "sewer_backup",
  "flooding",
  "odour",
  "damaged_asset",
  "discoloured_water",
  "water_quality",
  "other",
];

/** SRs that need supervisor attention (the default scope). */
const ATTENTION_STATUSES: SrStatus[] = ["new", "triaged"];

export function ServiceRequestListPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [pendingQ, setPendingQ] = useState(search.get("q") ?? "");
  const queryClient = useQueryClient();

  // Default scope: "needs attention" — anything new or triaged.
  // Exception: when filtered by asset, show all history by default since
  // the user's intent is "everything that's ever happened on this
  // asset", not just the active queue.
  const assetUidFilter = search.get("asset_uid") || undefined;
  const scope =
    (search.get("scope") as "attention" | "all") ?? (assetUidFilter ? "all" : "attention");

  const params: ServiceRequestListParams = {
    status: (search.get("status") as SrStatus) || undefined,
    category: (search.get("category") as SrCategory) || undefined,
    domain: (search.get("domain") as SrDomain) || undefined,
    asset_uid: search.get("asset_uid") || undefined,
    since: search.get("since") || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: 50,
  };

  const query = useServiceRequests(params);

  // Client-side priority filter — backend list endpoint doesn't accept
  // `priority` yet, but the dashboard's "by priority" segments deep-link
  // into us with ?priority=X. Apply it here so those links actually do
  // something. When the backend grows the param, swap to server-side.
  const priorityFilter = (search.get("priority") as SrPriority) || undefined;

  const visibleItems = useMemo(() => {
    let items = query.data?.items ?? [];
    if (scope === "attention" && !params.status) {
      items = items.filter((sr) => ATTENTION_STATUSES.includes(sr.status));
    }
    if (priorityFilter) {
      items = items.filter((sr) => sr.priority === priorityFilter);
    }
    return items;
  }, [query.data, scope, params.status, priorityFilter]);

  const summary = useMemo(() => {
    const items = query.data?.items ?? [];
    const newCount = items.filter((sr) => sr.status === "new").length;
    const triaged = items.filter((sr) => sr.status === "triaged").length;
    const high = items.filter(
      (sr) =>
        (sr.priority === "high" || sr.priority === "emergency") &&
        ATTENTION_STATUSES.includes(sr.status),
    ).length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = items.filter((sr) => new Date(sr.reported_at) >= today).length;
    return { newCount, triaged, high, newToday };
  }, [query.data]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearch(next);
  }

  function clearFilters() {
    setSearch(new URLSearchParams());
    setPendingQ("");
  }

  // Quick-triage from the row menu — sets status to "triaged" without
  // having to open the SR. Type narrows to mutable statuses (we never
  // transition to "dispatched" here — that happens via the SR detail's
  // Dispatch dialog which also creates the linked WO).
  type MutableSrStatus = "new" | "triaged" | "closed" | "duplicate";
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const update = useMutation<unknown, Error, { sr: string; status: MutableSrStatus }>({
    mutationFn: ({ sr, status }) => updateServiceRequest(sr, { status }),
    onSuccess: () => {
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setErrorMessage(translateApiError(e)),
  });

  /**
   * Defer the mutation by 4s so a toast undo can cancel it before any
   * network commit. Avoids the round-trip + state-flip + compensating
   * mutate dance that "fire then undo" would require, while preserving
   * the instant feel: the user sees the row gone from the active list
   * (because the cache already hides closed SRs in the active scope —
   * see scope filter above) the moment they click.
   */
  function deferMutate(sr: string, status: MutableSrStatus, label: string) {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) update.mutate({ sr, status });
    }, 4000);
    showToast({
      message: `${sr} ${label}.`,
      tone: "success",
      ttl: 4000,
      undo: () => {
        cancelled = true;
        window.clearTimeout(timer);
      },
    });
  }

  /**
   * Same defer-then-undo pattern as deferMutate, but for a batch. One
   * toast summarises the batch; one undo cancels the whole set. Used
   * by the bulk action bar so triaging 12 SRs is one action with one
   * undo, not 12 toasts.
   */
  function deferBulk(srs: string[], status: MutableSrStatus, label: string) {
    if (srs.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      for (const sr of srs) update.mutate({ sr, status });
    }, 4000);
    showToast({
      message: `${srs.length} request${srs.length === 1 ? "" : "s"} ${label}.`,
      tone: "success",
      ttl: 4000,
      undo: () => {
        cancelled = true;
        window.clearTimeout(timer);
      },
    });
    setSelected(new Set());
  }

  // Bulk-select state. Cleared on filter change so the operator doesn't
  // accidentally apply an action to rows they no longer see.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set());
  }, [params.status, params.category, params.domain, params.q, scope]);

  function toggleSelect(sr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sr)) next.delete(sr);
      else next.add(sr);
      return next;
    });
  }
  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const allUids = visibleItems.map((s) => s.sr_number);
      const allSelected = allUids.every((u) => prev.has(u));
      if (allSelected) return new Set();
      return new Set(allUids);
    });
  }

  const hasFilters = !!(
    params.status ||
    params.category ||
    params.domain ||
    params.q ||
    priorityFilter
  );

  return (
    <div className="p-4 sm:p-8 space-y-4">
      <PageHeader
        eyebrow="Citizen intake"
        title="Service requests"
        trailing={<Button onClick={() => setIntakeOpen(true)}>New intake</Button>}
      />

      <SummaryBar>
        <SummaryBar.Stat
          label="New"
          value={summary.newCount}
          tone={summary.newCount > 0 ? "warning" : "muted"}
          to="?status=new"
        />
        <SummaryBar.Stat
          label="Awaiting dispatch"
          value={summary.triaged}
          tone={summary.triaged > 0 ? "default" : "muted"}
          to="?status=triaged"
        />
        <SummaryBar.Stat
          label="High / emergency"
          value={summary.high}
          tone={summary.high > 0 ? "danger" : "muted"}
          to={summary.high > 0 ? "?priority=emergency" : undefined}
        />
        <SummaryBar.Stat
          label="Reported today"
          value={summary.newToday}
          tone={summary.newToday > 0 ? "default" : "muted"}
          to={
            summary.newToday > 0
              ? `?since=${new Date(new Date().setHours(0, 0, 0, 0)).toISOString()}`
              : undefined
          }
        />
        <SummaryBar.Stat label="Total" value={query.data?.total ?? 0} tone="muted" />
      </SummaryBar>

      {assetUidFilter && (
        <div className="flex items-center gap-2 rounded border border-signal/30 bg-signal/5 px-3 py-2 text-xs">
          <span className="section-label">Filtered by asset</span>
          <Link
            to={`/${slug}/assets/${assetUidFilter}`}
            className="font-mono text-slate-100 hover:text-cyan-200 hover:underline"
          >
            {assetUidFilter}
          </Link>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setParam("asset_uid", null)}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <ScopeTabs
          scope={scope}
          onChange={(s) => setParam("scope", s === "attention" ? null : s)}
        />
        <label>
          <span className="block text-slate-300">Status</span>
          <select
            value={params.status ?? ""}
            onChange={(e) => setParam("status", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1"
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
          <span className="block text-slate-300">Domain</span>
          <select
            value={params.domain ?? ""}
            onChange={(e) => setParam("domain", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1"
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
          <span className="block text-slate-300">Category</span>
          <select
            value={params.category ?? ""}
            onChange={(e) => setParam("category", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1"
          >
            <option value="">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", pendingQ || null);
          }}
          className="flex-1 max-w-xs"
        >
          <label>
            <span className="block text-slate-300">Search</span>
            <input
              value={pendingQ}
              onChange={(e) => setPendingQ(e.target.value)}
              onBlur={() => setParam("q", pendingQ || null)}
              placeholder="Number, caller, address, description"
              className="mt-1 w-full rounded border border-slate-700 px-2 py-1"
            />
          </label>
        </form>
      </div>

      {/* Bulk action bar — only renders when there's a selection. The
          actions hit `deferBulk` so the same toast+undo pattern as the
          row-action menu applies; one undo click cancels every queued
          mutation. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-signal/30 bg-signal/5 px-3 py-2 text-sm text-slate-100">
          <span className="font-medium">{selected.size} selected</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => deferBulk([...selected], "triaged", "marked triaged")}
            className="rounded border border-slate-600 px-2 py-1 text-xs hover:border-slate-400"
          >
            Mark triaged
          </button>
          <button
            type="button"
            onClick={() => deferBulk([...selected], "duplicate", "marked as duplicate")}
            className="rounded border border-slate-600 px-2 py-1 text-xs hover:border-slate-400"
          >
            Mark duplicate
          </button>
          <button
            type="button"
            onClick={() => deferBulk([...selected], "closed", "closed")}
            className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200 hover:border-red-400"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={
                    visibleItems.length > 0 && visibleItems.every((s) => selected.has(s.sr_number))
                  }
                  onChange={toggleSelectAllVisible}
                  className="h-4 w-4"
                />
              </th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Caller</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Reported</th>
              <th className="px-3 py-2">WO</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {visibleItems.map((sr) => {
              const urgent = sr.priority === "emergency" || sr.priority === "high";
              return (
                <tr
                  key={sr.sr_number}
                  className={`hover:bg-slate-800/40 ${urgent && sr.status !== "closed" ? "bg-red-500/[0.03]" : ""}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${sr.sr_number}`}
                      checked={selected.has(sr.sr_number)}
                      onChange={() => toggleSelect(sr.sr_number)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link
                      to={`/${slug}/service-requests/${sr.sr_number}`}
                      className="text-slate-100 hover:underline"
                    >
                      {sr.sr_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={STATUS_TONE[sr.status]} dot>
                      {sr.status}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill
                      tone={PRIORITY_TONE[sr.priority]}
                      dot={sr.priority === "emergency" || sr.priority === "high"}
                    >
                      {sr.priority}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 capitalize">{sr.category.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 capitalize">{sr.domain}</td>
                  <td className="px-3 py-2">{sr.caller_name ?? <Dash />}</td>
                  <td
                    className="px-3 py-2 max-w-xs truncate"
                    title={sr.reported_address ?? undefined}
                  >
                    {sr.reported_address ?? <Dash />}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {formatDateTime(sr.reported_at) || <Dash />}
                  </td>
                  <td className="px-3 py-2">
                    {sr.work_order_number ? (
                      <Link
                        to={`/${slug}/work-orders/${sr.work_order_number}`}
                        className="font-mono text-xs text-slate-200 hover:underline"
                      >
                        {sr.work_order_number}
                      </Link>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowActions label={`${sr.sr_number} actions`}>
                      <RowActions.Link to={`/${slug}/service-requests/${sr.sr_number}`}>
                        View details
                      </RowActions.Link>
                      {!["closed", "dispatched", "duplicate"].includes(sr.status) && (
                        <RowActions.Link to={`/${slug}/service-requests/${sr.sr_number}#dispatch`}>
                          Dispatch as WO…
                        </RowActions.Link>
                      )}
                      {sr.status === "new" && (
                        <>
                          <RowActions.Separator />
                          <RowActions.Action
                            onClick={() => deferMutate(sr.sr_number, "triaged", "marked triaged")}
                          >
                            Mark triaged
                          </RowActions.Action>
                        </>
                      )}
                      {!["closed", "duplicate"].includes(sr.status) && (
                        <>
                          <RowActions.Action
                            onClick={() =>
                              deferMutate(sr.sr_number, "duplicate", "marked as duplicate")
                            }
                          >
                            Mark as duplicate
                          </RowActions.Action>
                          <RowActions.Action
                            onClick={() => deferMutate(sr.sr_number, "closed", "closed")}
                          >
                            Close without dispatch
                          </RowActions.Action>
                        </>
                      )}
                      {sr.work_order_number && (
                        <>
                          <RowActions.Separator />
                          <RowActions.Link to={`/${slug}/work-orders/${sr.work_order_number}`}>
                            View linked WO
                          </RowActions.Link>
                        </>
                      )}
                    </RowActions>
                  </td>
                </tr>
              );
            })}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={11} className="p-0">
                  <EmptyState
                    title={
                      scope === "attention" && !hasFilters
                        ? "Nothing needs attention right now."
                        : hasFilters
                          ? "No service requests match these filters."
                          : "No service requests yet."
                    }
                    hint={
                      scope === "attention"
                        ? "Switch to All to see triaged + dispatched + closed history."
                        : hasFilters
                          ? "Try widening the filters or clearing them."
                          : "Log a new intake to get started."
                    }
                    action={
                      scope === "attention" && !hasFilters ? (
                        <Button variant="ghost" size="sm" onClick={() => setParam("scope", "all")}>
                          Show all
                        </Button>
                      ) : hasFilters ? (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setIntakeOpen(true)}>
                          New intake
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {intakeOpen && <IntakeDialog onClose={() => setIntakeOpen(false)} />}

      {errorMessage && <Alert>{errorMessage}</Alert>}
    </div>
  );
}

function ScopeTabs({
  scope,
  onChange,
}: {
  scope: "attention" | "all";
  onChange: (s: "attention" | "all") => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded border border-slate-700 bg-slate-950/40 p-0.5"
    >
      {(["attention", "all"] as const).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={scope === k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
            scope === k ? "bg-signal/20 text-white" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {k === "attention" ? "Needs attention" : "All"}
        </button>
      ))}
    </div>
  );
}
