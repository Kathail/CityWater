import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { ConditionBadge } from "../../components/ConditionBadge";
import { Dash } from "../../components/Dash";
import { RowActions } from "../../components/RowActions";
import { EmptyState } from "../../components/States";
import { StatusPill, type PillTone } from "../../components/StatusPill";
import { SummaryBar } from "../../components/SummaryBar";
import { formatDate } from "../../lib/format";
import { ExportButton } from "./ExportButton";
import { ImportDialog } from "./ImportDialog";
import { useAssetClasses, useAssets } from "./hooks";
import type { AssetListParams, AssetOut } from "./api";

const STATUSES = ["active", "abandoned", "removed", "proposed"] as const;

const STATUS_TONE: Record<AssetOut["status"], PillTone> = {
  active: "success",
  proposed: "info",
  abandoned: "muted",
  removed: "neutral",
};

type SortKey = "uid" | "class" | "status" | "condition" | "install" | "material";
type SortDir = "asc" | "desc";

export function AssetListPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const [pendingQ, setPendingQ] = useState(search.get("q") ?? "");
  const [importOpen, setImportOpen] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "uid",
    dir: "asc",
  });

  const params: AssetListParams = {
    class: search.get("class") ?? undefined,
    status: (search.get("status") as AssetListParams["status"]) ?? undefined,
    q: search.get("q") ?? undefined,
    page: Number(search.get("page") ?? 1),
    page_size: Number(search.get("page_size") ?? 50),
  };

  const classesQuery = useAssetClasses();
  const assetsQuery = useAssets(params);

  // Lookup map: class_code → human-readable name (so the table shows
  // "Hydrant" instead of "WAT_HYD"). Falls back to the code when the
  // class catalog hasn't loaded yet.
  const classNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classesQuery.data ?? []) map.set(c.code, c.name);
    return map;
  }, [classesQuery.data]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearch(next);
  }

  function clearFilters() {
    setSearch(new URLSearchParams());
    setPendingQ("");
  }

  const hasFilters = !!(params.class || params.status || params.q);

  // Client-side sort within the current page. (Backend list endpoint
  // doesn't accept a sort parameter yet; once it does, swap this for
  // server-side sort by passing the key through `setParam("sort", ...)`.)
  const sortedItems = useMemo(() => {
    const items = assetsQuery.data?.items ?? [];
    const sorted = [...items];
    sorted.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const cmp = compare(a, b, sort.key, classNameByCode);
      return cmp * dir;
    });
    return sorted;
  }, [assetsQuery.data, sort, classNameByCode]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  // Summary stats — derived from the current page's items + the
  // total count from the API. With paginated data we can't show
  // "active" vs "all" accurately across pages without an API change;
  // surfacing the total + the visible active count is honest.
  const total = assetsQuery.data?.total ?? 0;
  const visibleActive = sortedItems.filter((a) => a.status === "active").length;
  const visibleClasses = new Set(sortedItems.map((a) => a.class_code)).size;

  return (
    <div className="p-8 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Assets</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setImportOpen(true)}>
            Import…
          </Button>
          <ExportButton />
        </div>
      </header>

      <SummaryBar>
        <SummaryBar.Stat label="Total" value={total} />
        <SummaryBar.Stat
          label="Active on this page"
          value={visibleActive}
          sub={`of ${sortedItems.length} shown`}
          tone="success"
          to="?status=active"
        />
        <SummaryBar.Stat label="Classes on page" value={visibleClasses} />
        <SummaryBar.Stat
          label="Class catalogue"
          value={classesQuery.data?.length ?? "—"}
          to={`/${slug}/admin/asset-classes`}
        />
      </SummaryBar>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-300">Class</span>
          <select
            value={params.class ?? ""}
            onChange={(e) => setParam("class", e.target.value || null)}
            className="mt-1 rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
          >
            <option value="">All classes</option>
            {classesQuery.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
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
                {s}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", pendingQ || null);
          }}
          className="flex items-end gap-2"
        >
          <label className="block">
            <span className="text-xs text-slate-300">Search</span>
            <input
              value={pendingQ}
              onChange={(e) => setPendingQ(e.target.value)}
              placeholder="UID, material, manufacturer, model…"
              className="mt-1 w-72 rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <input
            type="checkbox"
            checked={showOptional}
            onChange={(e) => setShowOptional(e.target.checked)}
          />
          <span className="text-slate-300">Show install date + material</span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-300">
            <tr>
              <SortHeader sort={sort} k="uid" onToggle={toggleSort}>
                UID
              </SortHeader>
              <SortHeader sort={sort} k="class" onToggle={toggleSort}>
                Class
              </SortHeader>
              <SortHeader sort={sort} k="status" onToggle={toggleSort}>
                Status
              </SortHeader>
              <SortHeader sort={sort} k="condition" onToggle={toggleSort}>
                Condition
              </SortHeader>
              {showOptional && (
                <>
                  <SortHeader sort={sort} k="install" onToggle={toggleSort}>
                    Install date
                  </SortHeader>
                  <SortHeader sort={sort} k="material" onToggle={toggleSort}>
                    Material
                  </SortHeader>
                </>
              )}
              <th className="px-3 py-2 text-right">{/* actions */}</th>
            </tr>
          </thead>
          <tbody>
            {assetsQuery.isLoading && (
              <tr>
                <td colSpan={showOptional ? 7 : 5} className="px-3 py-6 text-slate-400 text-center">
                  Loading…
                </td>
              </tr>
            )}
            {sortedItems.length === 0 && !assetsQuery.isLoading && (
              <tr>
                <td colSpan={showOptional ? 7 : 5} className="p-0">
                  <EmptyState
                    title={hasFilters ? "No assets match these filters." : "No assets yet."}
                    hint={
                      hasFilters
                        ? "Try widening the filters or clearing them."
                        : "Import a CSV/GeoJSON, or add a Point asset directly on the map."
                    }
                    action={
                      hasFilters ? (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setImportOpen(true)}>
                          Import assets
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            )}
            {sortedItems.map((a) => (
              <tr
                key={a.asset_uid}
                className="border-t border-slate-800 transition-colors hover:bg-slate-800/30"
              >
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`./${a.asset_uid}`} className="text-slate-100 hover:underline">
                    {a.asset_uid}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {/* Human-readable name + small mono code beneath. The
                      code is still useful (CSV imports, search) but
                      shouldn't be the primary thing the eye lands on. */}
                  <div className="leading-tight">
                    <p className="text-slate-100">
                      {classNameByCode.get(a.class_code) ?? a.class_code}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">{a.class_code}</p>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill tone={STATUS_TONE[a.status]} dot>
                    {a.status}
                  </StatusPill>
                </td>
                <td className="px-3 py-2">
                  {a.condition === null ? <Dash /> : <ConditionBadge value={a.condition} />}
                </td>
                {showOptional && (
                  <>
                    <td className="px-3 py-2">
                      {a.install_date ? formatDate(a.install_date) : <Dash />}
                    </td>
                    <td className="px-3 py-2">{a.material ?? <Dash />}</td>
                  </>
                )}
                <td className="px-3 py-2 text-right">
                  <RowActions label={`${a.asset_uid} actions`}>
                    <RowActions.Link to={`./${a.asset_uid}`}>View details</RowActions.Link>
                    <RowActions.Separator />
                    <RowActions.Link to={`/${slug}/work-orders?new=1&asset_uid=${a.asset_uid}`}>
                      Create work order
                    </RowActions.Link>
                    <RowActions.Link to={`/${slug}/inspections?new=1&asset_uid=${a.asset_uid}`}>
                      Create inspection
                    </RowActions.Link>
                    <RowActions.Separator />
                    <RowActions.Link to={`/${slug}/work-orders?asset_uid=${a.asset_uid}`}>
                      View work orders
                    </RowActions.Link>
                    <RowActions.Link to={`/${slug}/inspections?asset_uid=${a.asset_uid}`}>
                      View inspections
                    </RowActions.Link>
                    <RowActions.Link to={`/${slug}/map?focus=${a.asset_uid}`}>
                      Locate on map
                    </RowActions.Link>
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {assetsQuery.data && (
        <div className="flex items-center justify-between text-sm text-slate-300">
          <span>
            Page {assetsQuery.data.page} · {assetsQuery.data.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setParam("page", String(Math.max(1, params.page! - 1)))}
              disabled={params.page! <= 1}
            >
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setParam("page", String(params.page! + 1))}
              disabled={
                assetsQuery.data.page * assetsQuery.data.page_size >= assetsQuery.data.total
              }
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sortable header cell — chevron indicates active sort + direction.          */
/* -------------------------------------------------------------------------- */

function SortHeader({
  k,
  sort,
  onToggle,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onToggle: (k: SortKey) => void;
  children: string;
}) {
  const active = sort.key === k;
  return (
    <th className="px-3 py-2 text-left">
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={`inline-flex items-center gap-1 transition-colors ${
          active ? "text-slate-100" : "text-slate-300 hover:text-slate-100"
        }`}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {children}
        <span className="text-[10px] text-slate-500" aria-hidden="true">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}
        </span>
      </button>
    </th>
  );
}

function compare(a: AssetOut, b: AssetOut, key: SortKey, classNames: Map<string, string>): number {
  switch (key) {
    case "uid":
      return a.asset_uid.localeCompare(b.asset_uid);
    case "class": {
      const an = classNames.get(a.class_code) ?? a.class_code;
      const bn = classNames.get(b.class_code) ?? b.class_code;
      return an.localeCompare(bn);
    }
    case "status":
      return a.status.localeCompare(b.status);
    case "condition":
      return (a.condition ?? 99) - (b.condition ?? 99);
    case "install":
      return (a.install_date ?? "").localeCompare(b.install_date ?? "");
    case "material":
      return (a.material ?? "").localeCompare(b.material ?? "");
    default:
      return 0;
  }
}
