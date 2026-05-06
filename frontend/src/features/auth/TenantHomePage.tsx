import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type DashboardResponse, getDashboard } from "../dashboard/api";
import { useAuth } from "./useAuth";

export function TenantHomePage() {
  const { user, tenant } = useAuth();
  const dash = useQuery<DashboardResponse, Error>({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    refetchInterval: 60_000,
  });

  if (!user || !tenant) return null;

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">
          Welcome, {user.full_name.split(" ")[0]}
        </h1>
        <p className="text-xs text-slate-400">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          · {tenant.name}
        </p>
      </header>

      {dash.data && <KpiStrip data={dash.data} slug={tenant.slug} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {dash.data && <TodayQueue items={dash.data.today_queue} slug={tenant.slug} />}
          {dash.data && <ByArea rows={dash.data.by_area} slug={tenant.slug} />}
          {dash.data && <CategoryChart buckets={dash.data.wo_by_category_30d} />}
        </div>
        <div className="space-y-4">
          {dash.data && (
            <SrPulse
              kpis={dash.data.sr_kpis}
              buckets={dash.data.sr_by_priority_30d}
              slug={tenant.slug}
            />
          )}
          {dash.data && <RecentActivity items={dash.data.recent_activity} slug={tenant.slug} />}
        </div>
      </div>
    </div>
  );
}

// ============== KPI STRIP ==============

const ACCENT: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/30" },
  red: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/40" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-300", border: "border-purple-500/30" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
  slate: { bg: "bg-slate-900", text: "text-slate-200", border: "border-slate-800" },
};

function KpiStrip({ data, slug }: { data: DashboardResponse; slug: string }) {
  const trend = data.throughput_7d;
  const max = Math.max(1, ...trend.map((t) => t.completed));
  const rate = data.wo_kpis.completion_rate_30d;
  const rateLabel = rate === null ? "—" : `${(rate * 100).toFixed(0)}%`;
  const rateAccent: keyof typeof ACCENT =
    rate === null ? "slate" : rate >= 1 ? "emerald" : rate >= 0.85 ? "amber" : "red";
  const closeLabel =
    data.wo_kpis.avg_close_hours_30d === null ? "—" : fmtHours(data.wo_kpis.avg_close_hours_30d);
  const resoLabel =
    data.sr_kpis.avg_resolution_hours_30d === null
      ? "—"
      : fmtHours(data.sr_kpis.avg_resolution_hours_30d);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Kpi
        to={`/${slug}/work-orders?status=open`}
        label="Open"
        value={data.wo_kpis.open}
        sub={`${data.wo_kpis.in_progress} active`}
        accent="blue"
      />
      <Kpi
        to={`/${slug}/work-orders`}
        label="Overdue"
        value={data.wo_kpis.overdue}
        sub={data.wo_kpis.stale_open ? `${data.wo_kpis.stale_open} stale 30d+` : "on time"}
        accent={data.wo_kpis.overdue > 0 ? "red" : "slate"}
      />
      <Kpi
        to={`/${slug}/service-requests?status=new`}
        label="New SRs"
        value={data.sr_kpis.new}
        sub={`${data.sr_kpis.triaged} triaged`}
        accent={data.sr_kpis.new > 0 ? "blue" : "slate"}
      />
      <Kpi
        to={`/${slug}/service-requests?status=triaged`}
        label="Awaiting"
        value={data.sr_kpis.triaged}
        sub="dispatch"
        accent="purple"
      />
      <Stat label="Completion 30d" value={rateLabel} sub={rateSub(rate)} accent={rateAccent} />
      <Stat label="Avg close" value={closeLabel} sub={`SR ${resoLabel}`} accent="slate" />
      <div className="col-span-2 sm:col-span-4 lg:col-span-1 rounded-md border border-slate-800 bg-slate-900 p-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            7-day done
          </p>
          <p className="text-lg font-semibold text-emerald-300 tabular-nums">
            {data.wo_kpis.completed_this_week}
          </p>
        </div>
        <div className="mt-1 flex h-6 items-end gap-0.5">
          {trend.map((t) => (
            <div
              key={t.date}
              title={`${t.date}: ${t.completed}`}
              className="flex-1 rounded-t bg-emerald-500/40 hover:bg-emerald-500/60"
              style={{ height: `${(t.completed / max) * 100}%`, minHeight: "2px" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function rateSub(rate: number | null): string {
  if (rate === null) return "—";
  if (rate >= 1) return "burning down";
  if (rate >= 0.85) return "stable";
  return "growing";
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}

function Kpi({
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
      className={`block rounded-md border ${a.border} ${a.bg} p-2.5 transition-colors hover:border-blue-500/50`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold ${a.text} tabular-nums`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: keyof typeof ACCENT;
}) {
  const a = ACCENT[accent];
  return (
    <div className={`rounded-md border ${a.border} ${a.bg} p-2.5`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold ${a.text} tabular-nums`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

// ============== TODAY'S QUEUE ==============

function TodayQueue({
  items,
  slug,
}: {
  items: DashboardResponse["today_queue"];
  slug: string;
}) {
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Your queue
        </h2>
        <Link
          to={`/${slug}/work-orders?assigned_to=me`}
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
        >
          See all →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          Nothing assigned today. Take a breath ☕
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((q) => {
            const pct =
              q.asset_total === 0 ? 0 : Math.round((q.asset_done / q.asset_total) * 100);
            return (
              <li key={q.wo_number}>
                <Link
                  to={`/${slug}/work-orders/${q.wo_number}`}
                  className="block rounded border border-slate-800 bg-slate-950/40 p-2 hover:border-blue-500/40 hover:bg-slate-900/80"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm text-slate-100">
                      <span className="font-mono text-[11px] text-slate-500 mr-2">
                        {q.wo_number}
                      </span>
                      {q.title}
                    </p>
                    <PriorityChip priority={q.priority} overdue={q.is_overdue} />
                  </div>
                  {q.asset_total > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        {q.asset_done}/{q.asset_total}
                      </span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PriorityChip({ priority, overdue }: { priority: string; overdue: boolean }) {
  const palette: Record<string, string> = {
    emergency: "bg-red-500/15 text-red-200 ring-red-500/40",
    high: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
    normal: "bg-slate-700/40 text-slate-300 ring-slate-600/40",
    low: "bg-slate-800 text-slate-500 ring-slate-700",
  };
  return (
    <div className="flex items-center gap-1">
      {overdue && (
        <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-medium uppercase text-red-200 ring-1 ring-red-500/40">
          Overdue
        </span>
      )}
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ring-1 ${
          palette[priority] ?? palette.normal
        }`}
      >
        {priority}
      </span>
    </div>
  );
}

// ============== BY AREA ==============

const AREA_KIND_GROUP: Record<string, string> = {
  maintenance: "Maintenance districts",
  water_system: "Water systems",
  sewer_system: "Wastewater systems",
  storm_system: "Storm drainage",
};

function ByArea({
  rows,
  slug,
}: {
  rows: DashboardResponse["by_area"];
  slug: string;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          By area
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          No service areas configured yet.{" "}
          <Link
            to={`/${slug}/admin`}
            className="text-blue-400 hover:text-blue-300 hover:underline"
          >
            Set up districts and systems →
          </Link>
        </p>
      </section>
    );
  }

  // Group by kind so the panel reads as: Maintenance — districts; Water systems — systems; etc.
  const byKind: Record<string, DashboardResponse["by_area"]> = {};
  for (const r of rows) (byKind[r.kind] ??= []).push(r);

  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
        By area
      </h2>
      <div className="mt-2 space-y-3">
        {Object.entries(byKind).map(([kind, kindRows]) => (
          <div key={kind}>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {AREA_KIND_GROUP[kind] ?? kind}
            </p>
            <ul className="mt-1 divide-y divide-slate-800/60">
              {kindRows.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 py-1.5 text-sm"
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color ?? "#475569" }}
                  />
                  <span className="flex-1 truncate text-slate-200">{a.name}</span>
                  <ByAreaStat label="WOs" value={a.active_wos} accent="blue" />
                  <ByAreaStat label="SRs" value={a.active_srs} accent="amber" />
                  {a.overdue_wos > 0 && (
                    <ByAreaStat
                      label="overdue"
                      value={a.overdue_wos}
                      accent="red"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ByAreaStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "blue" | "amber" | "red";
}) {
  const cls =
    accent === "red"
      ? "text-red-300"
      : accent === "amber"
        ? "text-amber-300"
        : "text-blue-300";
  if (value === 0) {
    return (
      <span className="inline-flex items-baseline gap-1 text-[11px] tabular-nums text-slate-600">
        <span>{value}</span>
        <span className="text-[10px] uppercase">{label}</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-baseline gap-1 text-[11px] tabular-nums ${cls}`}>
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-[10px] uppercase text-slate-500">{label}</span>
    </span>
  );
}

// ============== CATEGORY CHART ==============

function CategoryChart({
  buckets,
}: {
  buckets: DashboardResponse["wo_by_category_30d"];
}) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          WOs by category
        </h2>
        <p className="text-[11px] text-slate-500">30d · {total}</p>
      </div>
      {buckets.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No data.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {buckets.map((b) => (
            <li key={b.category} className="text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-200 capitalize text-[13px]">
                  {b.category.replace(/_/g, " ")}
                </span>
                <span className="tabular-nums text-slate-400 text-[11px]">{b.count}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500/60"
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============== SR PULSE ==============

const SR_PRIORITY_COLORS: Record<string, string> = {
  emergency: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-blue-500",
  low: "bg-slate-500",
};

function SrPulse({
  kpis,
  buckets,
  slug,
}: {
  kpis: DashboardResponse["sr_kpis"];
  buckets: DashboardResponse["sr_by_priority_30d"];
  slug: string;
}) {
  const totalPriority = buckets.reduce((s, b) => s + b.count, 0) || 1;
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Service requests
      </h2>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center">
        <SrChip label="New" value={kpis.new} to={`/${slug}/service-requests?status=new`} />
        <SrChip
          label="Triaged"
          value={kpis.triaged}
          to={`/${slug}/service-requests?status=triaged`}
        />
        <SrChip
          label="Dispatched"
          value={kpis.dispatched}
          to={`/${slug}/service-requests?status=dispatched`}
        />
        <SrChip
          label="Closed 7d"
          value={kpis.closed_this_week}
          to={`/${slug}/service-requests?status=closed`}
        />
      </div>
      {buckets.length > 0 && (
        <div className="mt-3">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            {buckets.map((b) => (
              <div
                key={b.priority}
                title={`${b.priority}: ${b.count}`}
                className={SR_PRIORITY_COLORS[b.priority] ?? "bg-slate-600"}
                style={{ width: `${(b.count / totalPriority) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
            {buckets.map((b) => (
              <li key={b.priority} className="flex items-center gap-1">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    SR_PRIORITY_COLORS[b.priority] ?? "bg-slate-600"
                  }`}
                />
                <span className="capitalize text-slate-300">{b.priority}</span>
                <span className="tabular-nums text-slate-500">{b.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SrChip({
  label,
  value,
  to,
}: {
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded border border-slate-800 bg-slate-950/40 px-1 py-1.5 hover:border-blue-500/40"
    >
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-100 tabular-nums">{value}</p>
    </Link>
  );
}

// ============== RECENT ACTIVITY ==============

function RecentActivity({
  items,
  slug,
}: {
  items: DashboardResponse["recent_activity"];
  slug: string;
}) {
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Quiet last 48 hours.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  item.kind === "comment" ? "bg-blue-400" : "bg-purple-400"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] text-slate-200">{item.summary}</p>
                <p className="text-[10px] text-slate-500">
                  <Link
                    to={entityLink(slug, item.entity_type)}
                    className="font-mono hover:text-blue-300"
                  >
                    {prettyEntity(item.entity_type)}
                  </Link>
                  {" · "}
                  {relativeTime(item.occurred_at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function prettyEntity(t: string): string {
  const map: Record<string, string> = {
    work_order: "WO",
    service_request: "SR",
    inspection: "INS",
    WorkOrder: "WO",
    ServiceRequest: "SR",
    Inspection: "INS",
  };
  return map[t] ?? t;
}

function entityLink(slug: string, t: string): string {
  switch (t) {
    case "work_order":
    case "WorkOrder":
      return `/${slug}/work-orders`;
    case "service_request":
    case "ServiceRequest":
      return `/${slug}/service-requests`;
    case "inspection":
    case "Inspection":
      return `/${slug}/inspections`;
    default:
      return `/${slug}/`;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
