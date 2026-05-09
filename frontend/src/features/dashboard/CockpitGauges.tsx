import { Link } from "react-router-dom";
import type { DashboardResponse } from "./api";
import type { DashTab } from "./DashboardTabs";

/**
 * Right-rail readout gauges. Radial SVG arcs that animate from 0 to
 * value on first paint — gives the page a moment of life on load and
 * communicates "live readout" without needing a chart library.
 *
 * Three gauges per tab:
 *  · supervisor → Open WOs / Overdue / New SRs (triage triad)
 *  · crew      → My queue today / Done today / Hours on shift
 *  · manager   → Completion rate 30d / Throughput 7d / Backlog 30d+
 *
 * Each gauge is a single arc whose fill represents the metric
 * relative to a sensible cap (so "39 new SRs" doesn't visually scream
 * if the cap is 100). Numerals use Instrument Serif for a single
 * editorial moment per page.
 */

interface Props {
  data: DashboardResponse;
  slug: string;
  tab: DashTab;
}

interface Gauge {
  label: string;
  value: number;
  cap: number;
  display: string;
  tone: "signal" | "warn" | "danger" | "neutral";
  href: string;
  caption?: string;
}

export function CockpitGauges({ data, slug, tab }: Props) {
  const gauges = useGauges(data, slug, tab);
  return (
    <aside
      aria-label="Readout"
      className="flex flex-col gap-3 console-panel p-4"
    >
      <div className="flex items-baseline justify-between border-b border-dashed border-slate-800 pb-2.5">
        <h2 className="section-label-strong">
          Readout
        </h2>
        <span className="section-label">
          {tab === "supervisor" ? "Triage" : tab === "crew" ? "Today" : "30d"}
        </span>
      </div>
      <ul className="flex flex-1 flex-col gap-3">
        {gauges.map((g) => (
          <li key={g.label}>
            <GaugeRow gauge={g} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

function GaugeRow({ gauge }: { gauge: Gauge }) {
  return (
    <Link
      to={gauge.href}
      className="group/g flex items-center gap-4 rounded p-2 transition-colors hover:bg-slate-900/60"
    >
      <Arc value={gauge.value} cap={gauge.cap} tone={gauge.tone} />
      <div className="min-w-0 flex-1">
        <p className="section-label">
          {gauge.label}
        </p>
        <p
          className={`font-display text-3xl leading-none tabular-nums ${
            gauge.tone === "danger"
              ? "text-rose-200"
              : gauge.tone === "warn"
                ? "text-amber-200"
                : gauge.tone === "signal"
                  ? "text-signal"
                  : "text-slate-100"
          }`}
        >
          {gauge.display}
        </p>
        {gauge.caption && (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {gauge.caption}
          </p>
        )}
      </div>
      <span
        aria-hidden
        className="font-mono text-[12px] text-slate-700 transition-all group-hover/g:translate-x-0.5 group-hover/g:text-signal"
      >
        →
      </span>
    </Link>
  );
}

const ARC_SIZE = 64;
const ARC_STROKE = 4;
const ARC_R = (ARC_SIZE - ARC_STROKE) / 2;
const ARC_C = 2 * Math.PI * ARC_R;

function Arc({ value, cap, tone }: { value: number; cap: number; tone: Gauge["tone"] }) {
  const ratio = cap === 0 ? 0 : Math.max(0, Math.min(1, value / cap));
  const target = ARC_C * (1 - ratio);
  // CSS variables drive the keyframe — see tailwind.config.ts. The arc
  // animates from `circumference` (empty) to `target` (filled) in
  // ~0.9s on mount.
  const style: React.CSSProperties = {
    ["--arc-circumference" as string]: `${ARC_C}`,
    ["--arc-target" as string]: `${target}`,
  };
  const strokeColor =
    tone === "danger"
      ? "#fb7185"
      : tone === "warn"
        ? "#f59e0b"
        : tone === "signal"
          ? "#67e8f9"
          : "#94a3b8";
  return (
    <svg
      width={ARC_SIZE}
      height={ARC_SIZE}
      viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}
      aria-hidden
      className="shrink-0 -rotate-90"
    >
      {/* Track — full circle in muted slate. */}
      <circle
        cx={ARC_SIZE / 2}
        cy={ARC_SIZE / 2}
        r={ARC_R}
        fill="none"
        stroke="rgb(30 41 59)"
        strokeWidth={ARC_STROKE}
      />
      {/* Tick marks at quarters — gives the gauge an instrument feel. */}
      {[0, 0.25, 0.5, 0.75].map((t) => {
        const a = t * 2 * Math.PI;
        const x1 = ARC_SIZE / 2 + (ARC_R - 2) * Math.cos(a);
        const y1 = ARC_SIZE / 2 + (ARC_R - 2) * Math.sin(a);
        const x2 = ARC_SIZE / 2 + (ARC_R + 1) * Math.cos(a);
        const y2 = ARC_SIZE / 2 + (ARC_R + 1) * Math.sin(a);
        return (
          <line
            key={t}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgb(51 65 85)"
            strokeWidth="1"
          />
        );
      })}
      {/* Filled arc — animates with arc-draw keyframe. */}
      <circle
        cx={ARC_SIZE / 2}
        cy={ARC_SIZE / 2}
        r={ARC_R}
        fill="none"
        stroke={strokeColor}
        strokeWidth={ARC_STROKE}
        strokeLinecap="round"
        strokeDasharray={ARC_C}
        strokeDashoffset={target}
        className="animate-arc-draw"
        style={style}
      />
    </svg>
  );
}

function useGauges(data: DashboardResponse, slug: string, tab: DashTab): Gauge[] {
  const wo = data.wo_kpis;
  const sr = data.sr_kpis;
  if (tab === "supervisor") {
    return [
      {
        label: "Open work",
        value: wo.open,
        cap: Math.max(50, wo.open),
        display: String(wo.open),
        tone: "signal",
        href: `/${slug}/work-orders?scope=active`,
        caption: `${wo.in_progress} in progress`,
      },
      {
        label: "Overdue",
        value: wo.overdue,
        cap: Math.max(10, wo.overdue),
        display: String(wo.overdue),
        tone: wo.overdue > 0 ? "danger" : "neutral",
        href: `/${slug}/work-orders?overdue=1`,
        caption: wo.overdue > 0 ? "past due date" : "all on time",
      },
      {
        label: "New service requests",
        value: sr.new,
        cap: Math.max(50, sr.new),
        display: String(sr.new),
        tone: sr.new > 0 ? "warn" : "neutral",
        href: `/${slug}/service-requests?status=new`,
        caption: `${sr.triaged} triaged · ${sr.dispatched} dispatched`,
      },
    ];
  }
  if (tab === "crew") {
    return [
      {
        label: "Your queue",
        value: data.today_queue.length,
        cap: Math.max(8, data.today_queue.length),
        display: String(data.today_queue.length),
        tone: "signal",
        href: `/${slug}/work-orders?assigned_to=me`,
        caption: "due today",
      },
      {
        label: "Done this week",
        value: wo.completed_this_week,
        cap: Math.max(10, wo.completed_this_week),
        display: String(wo.completed_this_week),
        tone: "neutral",
        href: `/${slug}/work-orders?status=completed`,
      },
      {
        label: "Hours logged",
        value: wo.hours_this_week,
        cap: 40,
        display: `${wo.hours_this_week.toFixed(1)} h`,
        tone: "neutral",
        href: `/${slug}/work-orders?assigned_to=me`,
        caption: "this week",
      },
    ];
  }
  // manager
  const completionPct =
    wo.completion_rate_30d == null ? 0 : Math.round(wo.completion_rate_30d * 100);
  const throughput = data.throughput_7d.reduce((s, d) => s + d.completed, 0);
  return [
    {
      label: "Completion 30d",
      value: completionPct,
      cap: 100,
      display: `${completionPct}%`,
      tone:
        completionPct >= 100
          ? "signal"
          : completionPct >= 80
            ? "neutral"
            : completionPct >= 50
              ? "warn"
              : "danger",
      href: `/${slug}/reports`,
      caption: completionPct >= 100 ? "burning down" : completionPct >= 80 ? "steady" : "behind",
    },
    {
      label: "Throughput 7d",
      value: throughput,
      cap: Math.max(20, throughput),
      display: String(throughput),
      tone: "signal",
      href: `/${slug}/work-orders?status=completed`,
      caption: `${(throughput / 7).toFixed(1)}/day avg`,
    },
    {
      label: "Stale 30d+",
      value: wo.stale_open,
      cap: Math.max(20, wo.stale_open),
      display: String(wo.stale_open),
      tone: wo.stale_open > 0 ? "warn" : "neutral",
      href: `/${slug}/work-orders?scope=active&stale=1`,
      caption: wo.stale_open > 0 ? "open ≥ 30 days" : "fresh",
    },
  ];
}
