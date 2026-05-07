import { Link } from "react-router-dom";
import { DashCard } from "./DashCard";
import type { DashboardResponse } from "./api";

/**
 * "System pulse" — combines the SR snapshot and the throughput
 * sparkline into a single right-column card so the right rail reads
 * as one cohesive object instead of three small floating panels.
 *
 * Iteration-3: prior version had ServiceRequestsCard + ThroughputSpark
 * as two separate cards; supervisors visually parsed them as
 * unrelated. They actually answer one question — "what's the system
 * doing right now?" — so they belong in one panel.
 *
 * Layout:
 *   Header: "System pulse" + total / completion-this-week trailing
 *   ──────────────────────────────────────────────────────────
 *   Top:    7-day completed-WO sparkline (compact, full width)
 *   Mid:    SR status row — 4 clickable status tiles
 *   Bottom: Priority breakdown bar + numeric chip legend
 */

const PRIORITY_BAR: Record<string, { bg: string }> = {
  emergency: { bg: "bg-red-500" },
  high: { bg: "bg-amber-500" },
  normal: { bg: "bg-blue-500" },
  low: { bg: "bg-slate-500" },
};
const PRIORITY_ORDER = ["emergency", "high", "normal", "low"];

export function SystemPulse({
  srKpis,
  srBuckets,
  throughput,
  completedThisWeek,
  slug,
}: {
  srKpis: DashboardResponse["sr_kpis"];
  srBuckets: DashboardResponse["sr_by_priority_30d"];
  throughput: DashboardResponse["throughput_7d"];
  completedThisWeek: number;
  slug: string;
}) {
  const total = srBuckets.reduce((s, b) => s + b.count, 0);
  const sortedBuckets = [...srBuckets].sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  );
  const max = Math.max(1, ...throughput.map((d) => d.completed));

  return (
    <DashCard
      title="System pulse"
      trailing={
        <span className="text-[11px] tabular-nums text-slate-500">
          {completedThisWeek}{" "}
          <span className="text-slate-600">closed this wk</span>
        </span>
      }
    >
      {/* Throughput sparkline — compact (h-10) since it's a context
          chart, not the headline. */}
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          7-day throughput
        </p>
        <div
          className="flex h-10 items-end gap-1"
          role="img"
          aria-label="Daily completed work for the past 7 days"
        >
          {throughput.map((d) => {
            const h = Math.max(2, (d.completed / max) * 100);
            const dayLabel = new Date(d.date).toLocaleDateString(undefined, { weekday: "short" });
            return (
              <div
                key={d.date}
                className="flex flex-1 flex-col items-center justify-end gap-0.5"
                title={`${dayLabel}: ${d.completed} completed`}
              >
                <div
                  className="w-full rounded-t bg-emerald-500/40 transition-colors hover:bg-emerald-500/70"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[9px] uppercase text-slate-500">{dayLabel.slice(0, 1)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Service-request status tiles. */}
      <div className="mt-4 border-t border-slate-800 pt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Service requests
          </p>
          <Link
            to={`/${slug}/service-requests`}
            className="text-[11px] text-blue-300 hover:text-blue-200"
          >
            All →
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <SrStatusTile
            to={`/${slug}/service-requests?status=new`}
            label="New"
            value={srKpis.new}
            tone={srKpis.new > 0 ? "amber" : "neutral"}
          />
          <SrStatusTile
            to={`/${slug}/service-requests?status=triaged`}
            label="Triaged"
            value={srKpis.triaged}
            tone="info"
          />
          <SrStatusTile
            to={`/${slug}/service-requests?status=dispatched`}
            label="Dispatched"
            value={srKpis.dispatched}
            tone="info"
          />
          <SrStatusTile
            to={`/${slug}/service-requests?status=closed`}
            label="Closed 7d"
            value={srKpis.closed_this_week}
            tone="neutral"
          />
        </div>
      </div>

      {/* Priority breakdown — every segment is its own clickable
          drill-in instead of a static bar. Hover lifts so the
          interactivity is obvious. */}
      {total > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              By priority · 30d
            </p>
            <p className="text-[11px] tabular-nums text-slate-500">{total} total</p>
          </div>
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
            role="group"
            aria-label="Priority breakdown — clickable segments"
          >
            {sortedBuckets
              .filter((b) => b.count > 0)
              .map((b) => (
                <Link
                  key={b.priority}
                  to={`/${slug}/service-requests?priority=${b.priority}`}
                  className={`${PRIORITY_BAR[b.priority]?.bg ?? "bg-slate-600"} transition-opacity hover:opacity-80`}
                  style={{ width: `${(b.count / total) * 100}%` }}
                  title={`${b.count} ${b.priority}`}
                  aria-label={`${b.count} ${b.priority} priority — open list`}
                />
              ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-4">
            {PRIORITY_ORDER.map((p) => {
              const count = sortedBuckets.find((b) => b.priority === p)?.count ?? 0;
              const meta = PRIORITY_BAR[p];
              return (
                <li key={p}>
                  <Link
                    to={`/${slug}/service-requests?priority=${p}`}
                    className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-800/50"
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${meta?.bg ?? "bg-slate-600"}`}
                      aria-hidden="true"
                    />
                    <span className="capitalize text-slate-300">{p}</span>
                    <span className="ml-auto tabular-nums text-slate-500">{count}</span>
                  </Link>
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
}: {
  to: string;
  label: string;
  value: number;
  tone: "amber" | "info" | "neutral";
}) {
  const text =
    tone === "amber"
      ? "text-amber-200"
      : tone === "info"
        ? "text-blue-200"
        : "text-slate-200";
  const accent =
    tone === "amber"
      ? "hover:border-amber-500/40"
      : tone === "info"
        ? "hover:border-blue-500/40"
        : "hover:border-slate-600";
  return (
    <Link
      to={to}
      className={`block rounded border border-slate-800 bg-slate-950/40 px-2 py-2 transition-colors ${accent} hover:bg-slate-900/80`}
    >
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${text}`}>{value}</p>
    </Link>
  );
}
