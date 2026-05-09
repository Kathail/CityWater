import { Link } from "react-router-dom";
import { DOMAIN_DOT, DOMAIN_LABEL_SHORT } from "../../lib/theme";
import type { DashboardResponse } from "./api";
import type { DashTab } from "./DashboardTabs";

/**
 * The strip beneath the map. Three slim panels in one rule:
 *  · Throughput 7d sparkline + closed-this-week chip.
 *  · Service area chips — domain-coloured pills that deep-link to
 *    /map?area=<code>.
 *  · Today's category mix as a tiny stacked bar.
 *
 * Visual rule: every panel uses the same hairline rule chrome and
 * `.section-label` captions so the eye reads the strip as one
 * continuous band rather than three competing cards.
 */

interface Props {
  data: DashboardResponse;
  slug: string;
  tab: DashTab;
}

export function SystemPulseStrip({ data, slug, tab }: Props) {
  return (
    <section
      aria-label="System pulse"
      className="grid grid-cols-1 gap-4 console-panel lg:grid-cols-[1fr_1fr_1fr]"
    >
      <Spark
        throughput={data.throughput_7d}
        closedThisWeek={data.wo_kpis.completed_this_week}
        slug={slug}
      />
      <AreaChips areas={data.by_area} slug={slug} />
      <CategoryMix buckets={data.wo_by_category_30d} slug={slug} tab={tab} />
    </section>
  );
}

function Spark({
  throughput,
  closedThisWeek,
  slug,
}: {
  throughput: DashboardResponse["throughput_7d"];
  closedThisWeek: number;
  slug: string;
}) {
  const max = Math.max(1, ...throughput.map((d) => d.completed));
  return (
    <div className="border-b border-dashed border-slate-800 p-4 lg:border-b-0 lg:border-r">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="section-label-strong">
          Throughput
        </h3>
        <span className="section-label">
          7d · <span className="tabular-nums text-slate-200">{closedThisWeek}</span> this week
        </span>
      </div>
      <div
        className="flex h-20 items-end gap-1"
        role="img"
        aria-label="Daily completed work for the past 7 days"
      >
        {throughput.map((d, i) => {
          const ratio = max === 0 ? 0 : d.completed / max;
          const isToday = i === throughput.length - 1;
          const dayLabel = new Date(d.date).toLocaleDateString(undefined, { weekday: "short" });
          // Each bar links to the WO list filtered to that day's
          // completed work — reduces "I see throughput on Wed dropped,
          // what specifically did we close?" from a 4-click drill-down
          // to one. Days with zero completions still link (operator
          // sees an empty list, confirming the gap).
          return (
            <Link
              key={d.date}
              to={`/${slug}/work-orders?status=completed&completed_on=${d.date}`}
              className="group/bar flex flex-1 flex-col items-stretch gap-1"
              title={`${dayLabel}: ${d.completed} completed`}
              aria-label={`${dayLabel}: ${d.completed} completed work orders — open list`}
            >
              <div className="relative flex flex-1 items-end overflow-hidden rounded-sm bg-slate-800/40 transition-colors group-hover/bar:bg-slate-800/70">
                <div
                  className={`w-full rounded-sm transition-colors ${
                    isToday
                      ? "bg-signal group-hover/bar:bg-cyan-200"
                      : "bg-signal/40 group-hover/bar:bg-signal/70"
                  }`}
                  style={{ minHeight: d.completed > 0 ? "3px" : "0", height: `${ratio * 100}%` }}
                />
              </div>
              <span className="text-center font-mono text-[9px] uppercase text-slate-600 group-hover/bar:text-slate-300">
                {dayLabel.slice(0, 1)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function AreaChips({
  areas,
  slug,
}: {
  areas: DashboardResponse["by_area"];
  slug: string;
}) {
  if (areas.length === 0) {
    return (
      <div className="border-b border-dashed border-slate-800 p-4 lg:border-b-0 lg:border-r">
        <h3 className="mb-2 section-label-strong">
          Service areas
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">
          None configured
        </p>
      </div>
    );
  }
  // Group by kind for the chip strip — keeps the same visual order as
  // the map's layer panel.
  const grouped = new Map<string, DashboardResponse["by_area"]>();
  for (const a of areas) {
    if (!grouped.has(a.kind)) grouped.set(a.kind, []);
    grouped.get(a.kind)!.push(a);
  }
  return (
    <div className="border-b border-dashed border-slate-800 p-4 lg:border-b-0 lg:border-r">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="section-label-strong">
          Areas
        </h3>
        <Link
          to={`/${slug}/map`}
          className="section-label hover:text-signal"
        >
          Open map →
        </Link>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {Array.from(grouped.entries()).flatMap(([kind, group]) =>
          group.map((a) => {
            const total = a.active_wos + a.active_srs;
            const isHot = a.overdue_wos > 0;
            return (
              <li key={a.id}>
                <Link
                  to={`/${slug}/map?area=${encodeURIComponent(a.code)}`}
                  className={`group/chip inline-flex items-baseline gap-2 rounded-full border px-2.5 py-1 transition-colors ${
                    isHot
                      ? "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10"
                      : "border-slate-700/60 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/80"
                  }`}
                  title={`${DOMAIN_LABEL_SHORT[kind] ?? kind} · ${a.name} · ${a.active_wos} open · ${a.active_srs} SR · ${a.overdue_wos} overdue`}
                >
                  {/* Domain dot is the only kind affordance — the
                      label was redundant when the area name already
                      includes "maintenance"/"water"/etc. */}
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full ${DOMAIN_DOT[kind] ?? "bg-slate-500"}`}
                  />
                  <span className="text-[12px] text-slate-200 truncate max-w-[12rem]">
                    {a.name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-slate-500">
                    {total}
                  </span>
                  {isHot && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-rose-300">
                      ●
                    </span>
                  )}
                </Link>
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
}

function CategoryMix({
  buckets,
  slug,
  tab,
}: {
  buckets: DashboardResponse["wo_by_category_30d"];
  slug: string;
  tab: DashTab;
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const top = [...buckets].sort((a, b) => b.count - a.count).slice(0, 4);
  return (
    <div className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="section-label-strong">
          {tab === "manager" ? "Mix · 30d" : "Category"}
        </h3>
        <span className="section-label">
          <span className="tabular-nums text-slate-200">{total}</span> wo
        </span>
      </div>
      {total === 0 ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">
          Nothing logged
        </p>
      ) : (
        <ul className="space-y-1.5">
          {top.map((b) => {
            const pct = total === 0 ? 0 : (b.count / total) * 100;
            return (
              <li key={b.category}>
                <Link
                  to={`/${slug}/work-orders?category=${encodeURIComponent(b.category)}`}
                  className="block group/cat"
                >
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="capitalize text-slate-300 group-hover/cat:text-slate-100">
                      {b.category.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">{b.count}</span>
                  </div>
                  <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-signal/60 transition-all group-hover/cat:bg-signal"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
