import { Link } from "react-router-dom";
import { DashCard } from "./DashCard";
import type { DashboardResponse } from "./api";

/**
 * Service-area workload — grouped by domain (Maintenance, Water,
 * Wastewater, Storm) with a clear visual identity per group.
 *
 * Iteration-2 refinements:
 * - Wrapped in <DashCard> so the chrome matches every other panel.
 * - Domain labels carry an inline coloured chip instead of a left-
 *   border band, which cuts visual chrome but keeps the colour cue.
 * - Row counts now hide zero values entirely (no greyed-out "0 SR"
 *   noise) and only surface what's actually true. The "open" count
 *   is always the primary read; overdue + SR are secondary chips
 *   that only render when non-zero.
 * - Group-level "All quiet" line when every area in a domain has
 *   zero active counts — saves the eye scanning a wall of "0 0 0".
 */

const DOMAIN_META: Record<
  string,
  { label: string; chip: string }
> = {
  maintenance: { label: "Maintenance districts", chip: "bg-amber-500" },
  water_system: { label: "Water systems", chip: "bg-blue-500" },
  sewer_system: { label: "Wastewater systems", chip: "bg-emerald-500" },
  storm_system: { label: "Storm drainage", chip: "bg-purple-500" },
};

const DOMAIN_ORDER = ["maintenance", "water_system", "sewer_system", "storm_system"];

export function ByArea({ rows, slug }: { rows: DashboardResponse["by_area"]; slug: string }) {
  if (rows.length === 0) {
    return (
      <DashCard title="Service areas" to={`/${slug}/admin`} linkLabel="Configure">
        <p className="text-sm text-slate-500">
          No service areas configured yet. Add maintenance districts and
          water/sewer/storm systems in admin to drive workload by area.
        </p>
      </DashCard>
    );
  }

  const byKind: Record<string, DashboardResponse["by_area"]> = {};
  for (const r of rows) (byKind[r.kind] ??= []).push(r);
  const orderedKinds = DOMAIN_ORDER.filter((k) => byKind[k]?.length);

  return (
    <DashCard title="Service areas" to={`/${slug}/map`} linkLabel="Open map">
      <div className="space-y-4">
        {orderedKinds.map((kind) => {
          const meta = DOMAIN_META[kind] ?? { label: kind, chip: "bg-slate-600" };
          const areas = byKind[kind];
          const allQuiet = areas.every(
            (a) => a.active_wos === 0 && a.overdue_wos === 0 && a.active_srs === 0,
          );
          return (
            <div key={kind}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${meta.chip}`} aria-hidden />
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  {meta.label}
                </p>
                <span className="text-[10px] text-slate-600">·</span>
                <span className="text-[10px] tabular-nums text-slate-500">
                  {areas.length} {areas.length === 1 ? "area" : "areas"}
                </span>
              </div>

              {allQuiet ? (
                <p className="pl-4 text-xs italic text-slate-600">All quiet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {areas.map((a) => (
                    <li key={a.id}>
                      <AreaRow row={a} slug={slug} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

/**
 * One area row. Layout is: name (truncates), then a tight cluster of
 * counts on the right. Zero counts disappear entirely so the row
 * reads as cleanly as possible — supervisor only sees what matters.
 */
function AreaRow({
  row,
  slug,
}: {
  row: DashboardResponse["by_area"][number];
  slug: string;
}) {
  const isQuiet = row.active_wos === 0 && row.overdue_wos === 0 && row.active_srs === 0;
  return (
    <Link
      to={`/${slug}/map`}
      className="grid grid-cols-[1fr_auto] items-center gap-3 rounded px-1.5 py-1 text-sm transition-colors hover:bg-slate-800/40"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: row.color ?? "#475569" }}
          aria-hidden
        />
        <span className={`truncate ${isQuiet ? "text-slate-500" : "text-slate-100"}`}>
          {row.name}
        </span>
      </span>

      {isQuiet ? (
        <span className="text-[10px] text-slate-600">—</span>
      ) : (
        <span className="flex items-baseline gap-2 tabular-nums">
          {row.active_wos > 0 && (
            <span className="text-sm font-semibold text-slate-100">
              {row.active_wos}
              <span className="ml-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                {" "}
                open
              </span>
            </span>
          )}
          {row.overdue_wos > 0 && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-200 ring-1 ring-red-500/30">
              {row.overdue_wos} overdue
            </span>
          )}
          {row.active_srs > 0 && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200 ring-1 ring-amber-500/20">
              {row.active_srs} SR
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
