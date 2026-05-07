import { Link } from "react-router-dom";
import type { DashboardResponse } from "./api";

/**
 * Hero KPIs — the three numbers a supervisor checks first thing.
 *
 * Iteration-2 refinements:
 *
 * - Unified card chrome (same border + same dark-slate background on
 *   every tile) so the three tiles read as siblings, not three
 *   different colour categories. Colour is now used only as an accent
 *   bar on the left + a tinted value, so meaning still pops without
 *   the "uneven backgrounds" problem.
 * - Larger value text (text-4xl) and tighter sub-line so the number
 *   becomes the primary read.
 * - Inline "view →" affordance per tile so the actionability is visible,
 *   not just inferred from the cursor change.
 * - Secondary stats now live in their own bordered panel under the
 *   tiles instead of a bare <dl> that visually disappeared.
 */

interface Props {
  data: DashboardResponse;
  slug: string;
}

export function KpiHero({ data, slug }: Props) {
  const wo = data.wo_kpis;
  const sr = data.sr_kpis;

  return (
    <section aria-label="Today at a glance" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          to={`/${slug}/work-orders?status=open`}
          label="Open work orders"
          value={wo.open}
          sub={`${wo.in_progress} in progress`}
          accent="blue"
        />
        <KpiTile
          to={`/${slug}/work-orders?overdue=1`}
          label="Overdue"
          value={wo.overdue}
          sub={wo.stale_open ? `${wo.stale_open} stale 30d+` : "on time"}
          accent={wo.overdue > 0 ? "red" : "neutral"}
        />
        <KpiTile
          to={`/${slug}/service-requests?status=new`}
          label="New service requests"
          value={sr.new}
          sub={`${sr.triaged} triaged · ${sr.dispatched} dispatched`}
          accent={sr.new > 0 ? "amber" : "neutral"}
        />
      </div>

      {/* Secondary stats — bordered panel so the row reads as a single
          cohesive object rather than four floating numbers. Same
          label-over-value pattern as the tiles for visual rhythm. */}
      <div
        role="region"
        aria-label="Throughput context"
        className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3 sm:grid-cols-4"
      >
        <SecondaryStat label="Completion 30d" value={pctOrDash(wo.completion_rate_30d)} />
        <SecondaryStat label="Avg close" value={fmtHours(wo.avg_close_hours_30d)} />
        <SecondaryStat label="Done this week" value={String(wo.completed_this_week)} />
        <SecondaryStat label="Hours logged this week" value={`${wo.hours_this_week.toFixed(1)} h`} />
      </div>
    </section>
  );
}

const ACCENT: Record<
  "blue" | "red" | "amber" | "neutral",
  { bar: string; value: string }
> = {
  blue: { bar: "bg-blue-500", value: "text-slate-100" },
  red: { bar: "bg-red-500", value: "text-red-200" },
  amber: { bar: "bg-amber-500", value: "text-amber-200" },
  neutral: { bar: "bg-slate-700", value: "text-slate-100" },
};

function KpiTile({
  to,
  label,
  value,
  sub,
  accent,
}: {
  to: string;
  label: string;
  value: number;
  sub?: string;
  accent: keyof typeof ACCENT;
}) {
  const a = ACCENT[accent];
  return (
    <Link
      to={to}
      className="group relative block overflow-hidden rounded-md border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700 hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      aria-label={`${value} ${label}${sub ? ", " + sub : ""}`}
    >
      {/* Left accent bar — colour-codes the tile without recolouring
          the whole card. */}
      <span className={`absolute left-0 top-0 h-full w-1 ${a.bar}`} aria-hidden="true" />

      <div className="pl-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className={`mt-2 text-4xl font-semibold tabular-nums leading-none ${a.value}`}>
          {value}
        </p>
        {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
      </div>

      <span
        aria-hidden="true"
        className="absolute right-3 top-3 text-xs text-slate-600 transition-colors group-hover:text-blue-300"
      >
        view →
      </span>
    </Link>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-100">{value}</p>
    </div>
  );
}

function pctOrDash(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} m`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}
