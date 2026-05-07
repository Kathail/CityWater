import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { Dash } from "../../components/Dash";
import { RowActions } from "../../components/RowActions";
import { EmptyState } from "../../components/States";
import { StatusPill, type PillTone } from "../../components/StatusPill";
import { SummaryBar } from "../../components/SummaryBar";
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

const STATUS_TONE: Record<SrStatus, PillTone> = {
  new: "info",
  triaged: "warning",
  dispatched: "info",
  closed: "muted",
  duplicate: "muted",
};

const PRIORITY_TONE: Record<SrPriority, PillTone> = {
  emergency: "danger",
  high: "warning",
  normal: "neutral",
  low: "muted",
};

/** SRs that need supervisor attention (the default scope). */
const ATTENTION_STATUSES: SrStatus[] = ["new", "triaged"];

export function ServiceRequestListPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [pendingQ, setPendingQ] = useState(search.get("q") ?? "");
  const queryClient = useQueryClient();

  // Default scope: "needs attention" — anything new or triaged.
  const scope = (search.get("scope") as "attention" | "all") ?? "attention";

  const params: ServiceRequestListParams = {
    status: (search.get("status") as SrStatus) || undefined,
    category: (search.get("category") as SrCategory) || undefined,
    domain: (search.get("domain") as SrDomain) || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: 50,
  };

  const query = useServiceRequests(params);

  const visibleItems = useMemo(() => {
    const items = query.data?.items ?? [];
    if (scope === "attention" && !params.status) {
      return items.filter((sr) => ATTENTION_STATUSES.includes(sr.status));
    }
    return items;
  }, [query.data, scope, params.status]);

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
  const update = useMutation<unknown, Error, { sr: string; status: MutableSrStatus }>({
    mutationFn: ({ sr, status }) => updateServiceRequest(sr, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["service-requests"] }),
    onError: (e) => alert(translateApiError(e)),
  });

  const hasFilters = !!(params.status || params.category || params.domain || params.q);

  return (
    <div className="p-8 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Service requests</h1>
        <Button onClick={() => setIntakeOpen(true)}>New intake</Button>
      </header>

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
        />
        <SummaryBar.Stat label="Reported today" value={summary.newToday} tone="muted" />
        <SummaryBar.Stat label="Total" value={query.data?.total ?? 0} tone="muted" />
      </SummaryBar>

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

      <div className="overflow-x-auto rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-left text-xs uppercase text-slate-400">
            <tr>
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
                            onClick={() => update.mutate({ sr: sr.sr_number, status: "triaged" })}
                          >
                            Mark triaged
                          </RowActions.Action>
                        </>
                      )}
                      {!["closed", "duplicate"].includes(sr.status) && (
                        <>
                          <RowActions.Action
                            onClick={() => update.mutate({ sr: sr.sr_number, status: "duplicate" })}
                          >
                            Mark as duplicate
                          </RowActions.Action>
                          <RowActions.Action
                            onClick={() => {
                              if (confirm(`Close ${sr.sr_number} without dispatching a WO?`))
                                update.mutate({ sr: sr.sr_number, status: "closed" });
                            }}
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
                <td colSpan={10} className="p-0">
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
            scope === k ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {k === "attention" ? "Needs attention" : "All"}
        </button>
      ))}
    </div>
  );
}
