import { Link } from "react-router-dom";
import { DashCard } from "./DashCard";
import type { DashboardResponse } from "./api";

/**
 * Service-request status overview — 4 status counts as clickable
 * tiles + a single, well-aligned priority distribution bar with
 * inline numeric breakdown.
 *
 * Iteration-2: wrapped in <DashCard> so chrome matches the rest of
 * the dashboard panels.
 */

const PRIORITY_BAR: Record<string, { bg: string }> = {
  emergency: { bg: "bg-red-500" },
  high: { bg: "bg-amber-500" },
  normal: { bg: "bg-blue-500" },
  low: { bg: "bg-slate-500" },
};

const PRIORITY_ORDER = ["emergency", "high", "normal", "low"];

export function ServiceRequestsCard({
  kpis,
  buckets,
  slug,
}: {
  kpis: DashboardResponse["sr_kpis"];
  buckets: DashboardResponse["sr_by_priority_30d"];
  slug: string;
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const sortedBuckets = [...buckets].sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  );

  return (
    <DashCard title="Service requests" to={`/${slug}/service-requests`} linkLabel="See all">
      <div className="grid grid-cols-4 gap-2">
        <SrStatusTile
          to={`/${slug}/service-requests?status=new`}
          label="New"
          value={kpis.new}
          tone={kpis.new > 0 ? "amber" : "neutral"}
        />
        <SrStatusTile
          to={`/${slug}/service-requests?status=triaged`}
          label="Triaged"
          value={kpis.triaged}
          tone="info"
        />
        <SrStatusTile
          to={`/${slug}/service-requests?status=dispatched`}
          label="Dispatched"
          value={kpis.dispatched}
          tone="info"
        />
        <SrStatusTile
          to={`/${slug}/service-requests?status=closed`}
          label="Closed 7d"
          value={kpis.closed_this_week}
          tone="neutral"
          subtitle
        />
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              By priority · 30d
            </p>
            <p className="text-xs tabular-nums text-slate-500">{total} total</p>
          </div>
          <div
            className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-800"
            role="img"
            aria-label={`Priority breakdown: ${sortedBuckets.map((b) => `${b.count} ${b.priority}`).join(", ")}`}
          >
            {sortedBuckets.map((b) => (
              <div
                key={b.priority}
                className={PRIORITY_BAR[b.priority]?.bg ?? "bg-slate-600"}
                style={{ width: `${(b.count / total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-4">
            {PRIORITY_ORDER.map((p) => {
              const count = sortedBuckets.find((b) => b.priority === p)?.count ?? 0;
              const meta = PRIORITY_BAR[p];
              return (
                <li key={p} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${meta?.bg ?? "bg-slate-600"}`}
                    aria-hidden="true"
                  />
                  <span className="capitalize text-slate-300">{p}</span>
                  <span className="ml-auto tabular-nums text-slate-500">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DashCard>
  );
}

function SrStatusTile({
  to,
  label,
  value,
  tone,
  subtitle = false,
}: {
  to: string;
  label: string;
  value: number;
  tone: "amber" | "info" | "neutral";
  subtitle?: boolean;
}) {
  const text =
    tone === "amber"
      ? "text-amber-200"
      : tone === "info"
        ? "text-blue-200"
        : "text-slate-200";
  return (
    <Link
      to={to}
      className={`block rounded border px-2 py-2 transition-colors hover:border-blue-500/50 ${
        subtitle ? "border-slate-800 bg-slate-950/30" : "border-slate-800 bg-slate-950/40"
      }`}
    >
      <p
        className={`text-[10px] uppercase tracking-wider ${subtitle ? "text-slate-500" : "text-slate-400"}`}
      >
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${text}`}>{value}</p>
    </Link>
  );
}
