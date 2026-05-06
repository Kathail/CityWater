import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type DashboardResponse, getDashboard } from "../dashboard/api";
import { useAuth } from "./useAuth";

const QUICK_LINKS: { to: (slug: string) => string; label: string; hint: string }[] = [
  { to: (s) => `/${s}/map`, label: "Map", hint: "Spatial view of every asset class" },
  { to: (s) => `/${s}/assets`, label: "Assets", hint: "List, filter, and import" },
  { to: (s) => `/${s}/work-orders`, label: "Work orders", hint: "Open, assigned, in-progress" },
  { to: (s) => `/${s}/inspections`, label: "Inspections", hint: "Hydrant, valve, MH, CCTV" },
  { to: (s) => `/${s}/service-requests`, label: "Service requests", hint: "Intake → triage → dispatch" },
  { to: (s) => `/${s}/reports`, label: "Reports", hint: "5 canned reports, JSON / CSV / PDF" },
];

export function TenantHomePage() {
  const { user, tenant } = useAuth();
  const dash = useQuery<DashboardResponse, Error>({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    refetchInterval: 60_000, // 1 minute
  });

  if (!user || !tenant) return null;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">
          Welcome, {user.full_name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · <span className="text-slate-200">{tenant.name}</span>{" "}
          <span className="text-blue-400">/{tenant.slug}</span>
        </p>
      </header>

      {dash.data && <KpiStrip data={dash.data} slug={tenant.slug} />}
      {dash.data && <SupervisorRow data={dash.data} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {dash.data && <TodayQueue items={dash.data.today_queue} slug={tenant.slug} />}
          {dash.data && (
            <CategoryChart buckets={dash.data.wo_by_category_30d} />
          )}
        </div>
        <div className="space-y-6">
          {dash.data && <SrPulse kpis={dash.data.sr_kpis} buckets={dash.data.sr_by_priority_30d} slug={tenant.slug} />}
          {dash.data && <RecentActivity items={dash.data.recent_activity} slug={tenant.slug} />}
        </div>
      </div>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Jump to
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.label}
              to={link.to(tenant.slug)}
              className="surface group p-3 text-center transition-colors hover:border-blue-500/50 hover:bg-slate-900/80"
            >
              <p className="text-sm font-medium text-slate-100 group-hover:text-blue-300">
                {link.label}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

// ============== KPI STRIP ==============

function KpiStrip({ data, slug }: { data: DashboardResponse; slug: string }) {
  const trend = data.throughput_7d;
  const max = Math.max(1, ...trend.map((t) => t.completed));

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        to={`/${slug}/work-orders?status=open`}
        label="Open WOs"
        value={data.wo_kpis.open}
        accent="blue"
      />
      <KpiCard
        to={`/${slug}/work-orders?status=in_progress`}
        label="In progress"
        value={data.wo_kpis.in_progress}
        accent="amber"
      />
      <KpiCard
        to={`/${slug}/work-orders`}
        label="Overdue"
        value={data.wo_kpis.overdue}
        accent={data.wo_kpis.overdue > 0 ? "red" : "slate"}
      />
      <KpiCard
        to={`/${slug}/service-requests?status=new`}
        label="New SRs"
        value={data.sr_kpis.new}
        accent={data.sr_kpis.new > 0 ? "blue" : "slate"}
      />
      <KpiCard
        to={`/${slug}/service-requests?status=triaged`}
        label="Awaiting dispatch"
        value={data.sr_kpis.triaged}
        accent="purple"
      />
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          7-day throughput
        </p>
        <p className="mt-1 text-2xl font-semibold text-emerald-300">
          {data.wo_kpis.completed_this_week}
        </p>
        <div className="mt-2 flex h-8 items-end gap-1">
          {trend.map((t) => (
            <div
              key={t.date}
              title={`${t.date}: ${t.completed} completed`}
              className="flex-1 rounded-t bg-emerald-500/40 hover:bg-emerald-500/60"
              style={{ height: `${(t.completed / max) * 100}%`, minHeight: "2px" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const ACCENT: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/30" },
  red: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/40" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-300", border: "border-purple-500/30" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
  slate: { bg: "bg-slate-800/40", text: "text-slate-200", border: "border-slate-700" },
};

// ============== SUPERVISOR ROW ==============

function SupervisorRow({ data }: { data: DashboardResponse }) {
  const rate = data.wo_kpis.completion_rate_30d;
  const rateLabel =
    rate === null ? "—" : `${(rate * 100).toFixed(0)}%`;
  const rateAccent: keyof typeof ACCENT =
    rate === null ? "slate" : rate >= 1 ? "emerald" : rate >= 0.85 ? "amber" : "red";

  const hours = data.wo_kpis.hours_this_week;
  const stops = data.wo_kpis.stops_completed_this_week;
  const closeHrs = data.wo_kpis.avg_close_hours_30d;
  const closeLabel = closeHrs === null ? "—" : fmtHours(closeHrs);
  const resoHrs = data.sr_kpis.avg_resolution_hours_30d;
  const resoLabel = resoHrs === null ? "—" : fmtHours(resoHrs);
  const stale = data.wo_kpis.stale_open;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <SupTile
        label="Completion rate (30d)"
        value={rateLabel}
        accent={rateAccent}
        hint={
          rate === null
            ? "no WOs created"
            : rate >= 1
              ? "burning down backlog"
              : "backlog growing"
        }
      />
      <SupTile
        label="Avg close time"
        value={closeLabel}
        accent="blue"
        hint="WOs created → completed (30d)"
      />
      <SupTile
        label="Avg SR resolution"
        value={resoLabel}
        accent="purple"
        hint="reported → closed (30d)"
      />
      <SupTile
        label="Backlog > 30d"
        value={stale}
        accent={stale > 0 ? "amber" : "slate"}
        hint="stale open WOs"
      />
      <SupTile
        label="Hours / stops (7d)"
        value={`${hours.toFixed(1)}h · ${stops}`}
        accent="emerald"
        hint="time logged · asset stops done"
      />
    </div>
  );
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}

function SupTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent: keyof typeof ACCENT;
  hint?: string;
}) {
  const a = ACCENT[accent];
  return (
    <div className={`rounded-lg border ${a.border} ${a.bg} p-3`}>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-xl font-semibold ${a.text}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function KpiCard({
  to,
  label,
  value,
  accent,
}: {
  to: string;
  label: string;
  value: number;
  accent: keyof typeof ACCENT;
}) {
  const a = ACCENT[accent];
  return (
    <Link
      to={to}
      className={`block rounded-lg border ${a.border} ${a.bg} p-3 transition-colors hover:border-opacity-60 hover:bg-opacity-30`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${a.text}`}>{value}</p>
    </Link>
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
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
        <p className="mt-3 text-sm text-slate-500">
          Nothing assigned today. Take a breath ☕
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((q) => {
            const pct = q.asset_total === 0 ? 0 : Math.round((q.asset_done / q.asset_total) * 100);
            return (
              <li key={q.wo_number}>
                <Link
                  to={`/${slug}/work-orders/${q.wo_number}`}
                  className="block rounded-md border border-slate-800 bg-slate-950/40 p-3 hover:border-blue-500/50 hover:bg-slate-900/80"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm text-slate-100">
                      <span className="font-mono text-xs text-slate-500">{q.wo_number}</span>{" "}
                      {q.title}
                    </p>
                    <PriorityChip priority={q.priority} overdue={q.is_overdue} />
                  </div>
                  {q.asset_total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 tabular-nums">
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
    <div className="flex items-center gap-1.5">
      {overdue && (
        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-200 ring-1 ring-red-500/40">
          Overdue
        </span>
      )}
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ${
          palette[priority] ?? palette.normal
        }`}
      >
        {priority}
      </span>
    </div>
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Work orders by category
        </h2>
        <p className="text-xs text-slate-500">last 30 days · {total} total</p>
      </div>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No data.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {buckets.map((b) => (
            <li key={b.category} className="text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-200 capitalize">
                  {b.category.replace(/_/g, " ")}
                </span>
                <span className="tabular-nums text-slate-400">{b.count}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-800 overflow-hidden">
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
        Service request pulse
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <SrTile label="New" value={kpis.new} to={`/${slug}/service-requests?status=new`} />
        <SrTile label="Triaged" value={kpis.triaged} to={`/${slug}/service-requests?status=triaged`} />
        <SrTile label="Dispatched" value={kpis.dispatched} to={`/${slug}/service-requests?status=dispatched`} />
        <SrTile label="Closed (7d)" value={kpis.closed_this_week} to={`/${slug}/service-requests?status=closed`} />
      </div>
      {buckets.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
            Last 30 days by priority
          </p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
            {buckets.map((b) => (
              <div
                key={b.priority}
                title={`${b.priority}: ${b.count}`}
                className={SR_PRIORITY_COLORS[b.priority] ?? "bg-slate-600"}
                style={{ width: `${(b.count / totalPriority) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {buckets.map((b) => (
              <li key={b.priority} className="flex items-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
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

const SR_PRIORITY_COLORS: Record<string, string> = {
  emergency: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-blue-500",
  low: "bg-slate-500",
};

function SrTile({
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
      className="block rounded border border-slate-800 bg-slate-950/40 px-3 py-2 hover:border-blue-500/40 hover:bg-slate-900/80"
    >
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-slate-100">{value}</p>
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
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Quiet last 48 hours.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  item.kind === "comment" ? "bg-blue-400" : "bg-purple-400"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="truncate text-slate-200">{item.summary}</p>
                <p className="text-xs text-slate-500">
                  {item.kind === "comment" ? "Comment" : "Status change"}
                  {" · "}
                  <Link
                    to={entityLink(slug, item.entity_type, item.entity_id)}
                    className="font-mono hover:text-blue-300 hover:underline"
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

function entityLink(slug: string, t: string, _id: number): string {
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
