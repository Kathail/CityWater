import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { ConditionBadge } from "../../components/ConditionBadge";
import { Dash } from "../../components/Dash";
import { RowActions } from "../../components/RowActions";
import { EmptyState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { SummaryBar } from "../../components/SummaryBar";
import { formatDateTime } from "../../lib/format";
import { CreateInspectionDialog } from "./CreateInspectionDialog";
import { ImportPacpDialog } from "./ImportPacpDialog";
import { exportInspectionsUrl, type InspectionKind, type InspectionListParams } from "./api";
import { useInspections } from "./hooks";

const KINDS: { value: InspectionKind; label: string }[] = [
  { value: "hydrant_flow", label: "Hydrant flow" },
  { value: "valve_exercise", label: "Valve exercise" },
  { value: "manhole", label: "Manhole" },
  { value: "catch_basin", label: "Catch basin" },
  { value: "lift_station_round", label: "Lift station" },
  { value: "cctv", label: "CCTV (PACP)" },
];

const KIND_LABEL: Record<InspectionKind, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label]),
) as Record<InspectionKind, string>;

export function InspectionListPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const params: InspectionListParams = {
    kind: (search.get("kind") as InspectionKind) || undefined,
    asset_uid: search.get("asset_uid") || undefined,
    pass: (search.get("pass") as "true" | "false") || undefined,
    q: search.get("q") || undefined,
    page: Number(search.get("page") ?? 1),
    page_size: 50,
  };

  const insQuery = useInspections(params);

  // Deep-link prefill: navigate here with ?new=1&asset_uid=X&kind=Y
  // and we auto-open the create dialog with those defaults.
  const newDefaults = useMemo(() => {
    if (search.get("new") !== "1") return null;
    return {
      asset_uid: search.get("asset_uid") || undefined,
      kind: (search.get("kind") as InspectionKind) || undefined,
      work_order_number: search.get("work_order_number") || undefined,
    };
  }, [search]);

  useEffect(() => {
    if (newDefaults && !createOpen) setCreateOpen(true);
  }, [newDefaults, createOpen]);

  function handleCloseCreate() {
    setCreateOpen(false);
    if (newDefaults) {
      const next = new URLSearchParams(search);
      ["new", "kind", "work_order_number"].forEach((k) => next.delete(k));
      // Keep asset_uid in the URL so the user lands on the
      // asset-filtered list view after creating the inspection.
      setSearch(next, { replace: true });
    }
  }

  // Summary stats — derived from current page (because the API doesn't
  // expose a global pass/fail summary yet; future backend work could
  // add a /dashboard-style aggregate).
  const summary = useMemo(() => {
    const items = insQuery.data?.items ?? [];
    const total = insQuery.data?.total ?? 0;
    const passed = items.filter((i) => i.pass === true).length;
    const failed = items.filter((i) => i.pass === false).length;
    const conditionCounted = items.filter((i) => i.pass !== null).length;
    const passRate = conditionCounted > 0 ? Math.round((passed / conditionCounted) * 100) : null;
    const recentFailures = items.filter(
      (i) => i.pass === false && new Date(i.performed_at) > new Date(Date.now() - 7 * 86_400_000),
    ).length;
    return { total, passed, failed, passRate, recentFailures };
  }, [insQuery.data]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearch(next);
  }

  function clearFilters() {
    setSearch(new URLSearchParams());
  }

  const hasFilters = !!(params.kind || params.asset_uid || params.pass || params.q);

  return (
    <div className="p-8 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Inspections</h1>
        <div className="flex gap-2">
          <a href={exportInspectionsUrl(params.kind)} download className="btn-ghost">
            Export CSV
          </a>
          <Button variant="ghost" onClick={() => setImportOpen(true)}>
            Import PACP…
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New inspection</Button>
        </div>
      </header>

      <SummaryBar>
        <SummaryBar.Stat label="Total in dataset" value={summary.total} tone="muted" />
        <SummaryBar.Stat
          label="Pass rate (page)"
          value={summary.passRate === null ? "—" : `${summary.passRate}%`}
          tone={
            summary.passRate === null
              ? "muted"
              : summary.passRate >= 90
                ? "success"
                : summary.passRate >= 70
                  ? "warning"
                  : "danger"
          }
          to="?pass=true"
        />
        <SummaryBar.Stat
          label="Failed (page)"
          value={summary.failed}
          tone={summary.failed > 0 ? "danger" : "muted"}
          to="?pass=false"
        />
        <SummaryBar.Stat
          label="Failures last 7d"
          value={summary.recentFailures}
          tone={summary.recentFailures > 0 ? "warning" : "muted"}
          to="?pass=false"
        />
      </SummaryBar>

      {createOpen && (
        <CreateInspectionDialog onClose={handleCloseCreate} defaults={newDefaults ?? undefined} />
      )}
      {importOpen && <ImportPacpDialog onClose={() => setImportOpen(false)} />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-300">Kind</span>
          <select
            value={params.kind ?? ""}
            onChange={(e) => setParam("kind", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
          >
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("asset_uid") as HTMLInputElement;
            setParam("asset_uid", input.value || null);
          }}
          className="flex items-end gap-2"
        >
          <label className="block">
            <span className="text-xs text-slate-300">Asset UID</span>
            <input
              name="asset_uid"
              defaultValue={search.get("asset_uid") ?? ""}
              onBlur={(e) => setParam("asset_uid", e.target.value || null)}
              placeholder="e.g. HYD-00001"
              className="mt-1 w-48 rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </label>
          {params.asset_uid && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setParam("asset_uid", null)}
            >
              Clear
            </Button>
          )}
        </form>
        <label className="block">
          <span className="text-xs text-slate-300">Result</span>
          <select
            value={params.pass ?? ""}
            onChange={(e) => setParam("pass", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
          >
            <option value="">Any</option>
            <option value="true">Pass only</option>
            <option value="false">Fail only</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Number</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-left">Performed</th>
              <th className="px-3 py-2 text-left">Condition</th>
              <th className="px-3 py-2 text-left">Pass</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {insQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {insQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="p-0">
                  <EmptyState
                    title={
                      hasFilters ? "No inspections match these filters." : "No inspections yet."
                    }
                    hint={
                      hasFilters
                        ? "Try widening filters or clearing them."
                        : "Log a new inspection or import PACP results."
                    }
                    action={
                      hasFilters ? (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setCreateOpen(true)}>
                          New inspection
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            )}
            {insQuery.data?.items.map((i) => (
              <tr
                key={i.inspection_number}
                className={`border-t border-slate-800 transition-colors hover:bg-slate-800/30 ${
                  i.pass === false ? "bg-red-500/[0.04]" : ""
                }`}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`./${i.inspection_number}`} className="text-slate-100 hover:underline">
                    {i.inspection_number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-100">{KIND_LABEL[i.kind] ?? i.kind}</td>
                <td className="px-3 py-2 font-mono text-xs">{i.asset_uid ?? <Dash />}</td>
                <td className="px-3 py-2">{formatDateTime(i.performed_at)}</td>
                <td className="px-3 py-2">
                  {i.overall_condition === null ? (
                    <Dash />
                  ) : (
                    <ConditionBadge value={i.overall_condition} />
                  )}
                </td>
                <td className="px-3 py-2">
                  {i.pass === null ? (
                    <Dash />
                  ) : i.pass ? (
                    <StatusPill tone="success" dot>
                      Pass
                    </StatusPill>
                  ) : (
                    <StatusPill tone="danger" dot>
                      Fail
                    </StatusPill>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <RowActions label={`${i.inspection_number} actions`}>
                    <RowActions.Link to={`./${i.inspection_number}`}>View details</RowActions.Link>
                    {i.asset_uid && (
                      <>
                        <RowActions.Separator />
                        {/* Failed inspection? Pre-bias the follow-up WO at
                            high priority and a "repair" category — a
                            failed valve exercise almost always implies
                            corrective work. */}
                        <RowActions.Link
                          to={
                            `/${slug}/work-orders?new=1` +
                            `&asset_uid=${i.asset_uid}` +
                            `&title=${encodeURIComponent(
                              `Follow-up: ${KIND_LABEL[i.kind] ?? i.kind} on ${i.asset_uid}`,
                            )}` +
                            (i.pass === false
                              ? `&priority=high&category=repair`
                              : `&category=repair`)
                          }
                        >
                          Create follow-up work order
                        </RowActions.Link>
                        <RowActions.Link
                          to={`/${slug}/inspections?new=1&asset_uid=${i.asset_uid}&kind=${i.kind}`}
                        >
                          Re-inspect this asset
                        </RowActions.Link>
                        <RowActions.Separator />
                        <RowActions.Link to={`/${slug}/assets/${i.asset_uid}`}>
                          View asset
                        </RowActions.Link>
                        <RowActions.Link to={`/${slug}/inspections?asset_uid=${i.asset_uid}`}>
                          All inspections for this asset
                        </RowActions.Link>
                      </>
                    )}
                    {i.work_order_number && (
                      <RowActions.Link to={`/${slug}/work-orders/${i.work_order_number}`}>
                        View linked WO
                      </RowActions.Link>
                    )}
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
