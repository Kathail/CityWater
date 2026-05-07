import { Link } from "react-router-dom";
import type { DashboardResponse } from "./api";

/**
 * Hero KPIs — the three numbers a supervisor checks first thing,
 * plus the throughput/quality metrics that contextualise them.
 *
 * Iteration-3 refinements:
 *
 * - The whole tile is a single click target (no more "where do I click,
 *   the number or the small `view →`?"). The arrow on the corner pulses
 *   subtly on hover so the affordance is unmissable.
 * - Each tile carries a context-aware *quick action* button at the
 *   bottom (e.g. "+ New WO", "Triage queue") that's revealed on hover
 *   and is always available to keyboard users. This is the "I see
 *   something important → I can act on it" lever the dashboard was
 *   missing.
 * - Tiles are visually identical in chrome (border, padding, radii) so
 *   the eye reads them as a row of equals; colour is now a tinted left
 *   bar + tinted value only.
 * - The summary strip below has been promoted from a 4-cell <dl> into a
 *   row of clickable mini-stats with leading icons + colour-coded
 *   values. Each one routes into a useful filtered view.
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
          to={`/${slug}/work-orders?scope=active`}
          label="Open work orders"
          value={wo.open}
          sub={`${wo.in_progress} in progress`}
          accent="blue"
          quickAction={{
            to: `/${slug}/work-orders?new=1`,
            label: "+ New work order",
          }}
        />
        <KpiTile
          to={`/${slug}/work-orders?overdue=1`}
          label="Overdue"
          value={wo.overdue}
          sub={wo.stale_open ? `${wo.stale_open} stale 30d+` : "all on time"}
          accent={wo.overdue > 0 ? "red" : "neutral"}
          quickAction={
            wo.overdue > 0
              ? {
                  to: `/${slug}/work-orders?scope=active`,
                  label: "Review overdue →",
                }
              : undefined
          }
        />
        <KpiTile
          to={`/${slug}/service-requests?status=new`}
          label="New service requests"
          value={sr.new}
          sub={`${sr.triaged} triaged · ${sr.dispatched} dispatched`}
          accent={sr.new > 0 ? "amber" : "neutral"}
          quickAction={
            sr.new > 0
              ? {
                  to: `/${slug}/service-requests?scope=attention`,
                  label: "Triage queue →",
                }
              : undefined
          }
        />
      </div>

      {/* Summary strip — same chrome as the tiles, but laid out as a
          single row of mini-stats with leading icons. Each cell is a
          link, so a supervisor can click "Done this week" and land on
          the relevant filtered view instead of just reading a number. */}
      <div
        role="region"
        aria-label="Throughput context"
        className="flex flex-wrap items-stretch divide-x divide-slate-800 overflow-hidden rounded-md border border-slate-800 bg-slate-900/60"
      >
        <SummaryCell
          icon="✓"
          iconClass="text-emerald-400"
          label="Completion 30d"
          value={pctOrDash(wo.completion_rate_30d)}
          tone={completionTone(wo.completion_rate_30d)}
        />
        <SummaryCell
          icon="⏱"
          iconClass="text-slate-400"
          label="Avg close"
          value={fmtHours(wo.avg_close_hours_30d)}
        />
        <SummaryCell
          icon="↗"
          iconClass="text-blue-400"
          label="Done this week"
          value={String(wo.completed_this_week)}
          to={`/${slug}/work-orders?status=completed`}
        />
        <SummaryCell
          icon="⌛"
          iconClass="text-purple-400"
          label="Hours logged this week"
          value={`${wo.hours_this_week.toFixed(1)} h`}
        />
      </div>
    </section>
  );
}

const ACCENT: Record<
  "blue" | "red" | "amber" | "neutral",
  { bar: string; value: string; ring: string }
> = {
  blue: { bar: "bg-blue-500", value: "text-slate-100", ring: "focus:ring-blue-500/40" },
  red: { bar: "bg-red-500", value: "text-red-200", ring: "focus:ring-red-500/40" },
  amber: { bar: "bg-amber-500", value: "text-amber-200", ring: "focus:ring-amber-500/40" },
  neutral: { bar: "bg-slate-700", value: "text-slate-100", ring: "focus:ring-slate-500/40" },
};

interface QuickAction {
  to: string;
  label: string;
}

function KpiTile({
  to,
  label,
  value,
  sub,
  accent,
  quickAction,
}: {
  to: string;
  label: string;
  value: number;
  sub?: string;
  accent: keyof typeof ACCENT;
  quickAction?: QuickAction;
}) {
  const a = ACCENT[accent];
  return (
    <div
      className={`group/tile relative flex flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-900 transition-colors hover:border-slate-700 hover:bg-slate-900/80 focus-within:ring-2 ${a.ring}`}
    >
      {/* Left accent bar — colour-codes the tile without recolouring
          the whole card. Slightly thicker on hover so the tile
          "comes alive" when targeted. */}
      <span
        className={`absolute left-0 top-0 h-full w-1 transition-all group-hover/tile:w-1.5 ${a.bar}`}
        aria-hidden="true"
      />

      {/* Primary read — the entire tile body is a single click target,
          so a supervisor can land on the value and one click takes
          them to the relevant list. */}
      <Link
        to={to}
        aria-label={`${value} ${label}${sub ? ", " + sub : ""}`}
        className="flex-1 px-5 pt-5 pb-4 pl-6 focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {label}
          </p>
          {/* Affordance arrow — pulses on tile hover. */}
          <span
            aria-hidden="true"
            className="text-xs text-slate-600 transition-all group-hover/tile:translate-x-0.5 group-hover/tile:text-blue-300"
          >
            →
          </span>
        </div>
        <p className={`mt-2 text-4xl font-semibold tabular-nums leading-none ${a.value}`}>
          {value}
        </p>
        {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
      </Link>

      {/* Quick action — visible on hover or when keyboard-focused.
          Lets a supervisor jump from "I see overdue WOs" straight
          to the action without reading the value first. */}
      {quickAction && (
        <Link
          to={quickAction.to}
          className="border-t border-slate-800 bg-slate-950/40 px-5 py-1.5 pl-6 text-[11px] font-medium text-slate-400 opacity-0 transition-all hover:bg-slate-800/40 hover:text-slate-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40 group-hover/tile:opacity-100"
        >
          {quickAction.label}
        </Link>
      )}
    </div>
  );
}

function SummaryCell({
  icon,
  iconClass,
  label,
  value,
  tone,
  to,
}: {
  icon: string;
  iconClass: string;
  label: string;
  value: string;
  tone?: string;
  to?: string;
}) {
  const inner = (
    <div className="flex min-w-[160px] flex-1 items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className={`text-base ${iconClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-sm font-semibold tabular-nums ${tone ?? "text-slate-100"}`}>{value}</p>
      </div>
    </div>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="flex-1 transition-colors hover:bg-slate-800/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

function pctOrDash(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function completionTone(rate: number | null): string {
  if (rate === null) return "text-slate-100";
  if (rate >= 0.8) return "text-emerald-300";
  if (rate >= 0.5) return "text-amber-300";
  return "text-red-300";
}

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} m`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}
