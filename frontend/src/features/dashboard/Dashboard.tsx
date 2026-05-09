import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../../components/States";
import type { TenantOut, UserOut } from "../auth/api";
import { CockpitGauges } from "./CockpitGauges";
import { LiveFeed } from "./LiveFeed";
import { MapPreview } from "./MapPreview";
import { SystemPulseStrip } from "./SystemPulseStrip";
import { DashboardTabs, type DashTab } from "./DashboardTabs";
import { type DashboardResponse, getDashboard } from "./api";

/**
 * Operations-console dashboard.
 *
 * Three-column desktop layout (stacks on <lg):
 *
 *   ┌───────────┬──────────────────────────┬──────────────┐
 *   │ Live feed │ Map preview              │ Readout      │
 *   │           │ ─────────                │ gauges       │
 *   │ activity  │ System pulse strip       │              │
 *   │           │                          │              │
 *   └───────────┴──────────────────────────┴──────────────┘
 *
 * Tab bar above the grid switches the active "lens":
 *   · supervisor — default. Triage queue + ops snapshot.
 *   · crew      — your stops, your queue, your route.
 *   · manager   — backlog burn-down, throughput, weekly digest.
 *
 * Each lens reuses the same column shell and swaps its content; the
 * gauge labels, feed filters, and pulse readouts change but the
 * shape doesn't. The familiar shell is the point — supervisors rarely
 * wear two hats at once, but the page should still feel like the same
 * page when they do.
 *
 * Visual direction: industrial cockpit. Plex Sans body, Plex Mono for
 * tabular reads, Instrument Serif for the gauge numerals. Single
 * signal cyan; everything else is slate.
 */

interface Props {
  user: UserOut;
  tenant: TenantOut;
}

export function Dashboard({ user, tenant }: Props) {
  const [search, setSearch] = useSearchParams();
  const tab = (search.get("tab") as DashTab) ?? "supervisor";

  const dash = useQuery<DashboardResponse, Error>({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  function setTab(next: DashTab) {
    const nextSearch = new URLSearchParams(search);
    if (next === "supervisor") nextSearch.delete("tab");
    else nextSearch.set("tab", next);
    setSearch(nextSearch, { replace: true });
  }

  return (
    <div className="relative min-h-full">
      {/* Faint dot grid behind the whole page (.dot-grid-bg from
          index.css) — operations-console feel without competing for
          attention. */}
      <div aria-hidden className="dot-grid-bg" />

      <div className="relative z-10 mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <DashboardHeader user={user} tenant={tenant} />
        <DashboardTabs active={tab} onChange={setTab} />

        {dash.isLoading && !dash.data && <LoadingState />}
        {dash.isError && !dash.data && (
          <ErrorState message="Dashboard unavailable." retry={() => dash.refetch()} />
        )}

        {dash.data && (
          <DashboardGrid data={dash.data} tab={tab} slug={tenant.slug} userId={user.id} />
        )}
      </div>
    </div>
  );
}

function DashboardHeader({ user, tenant }: Props) {
  const now = new Date();
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <header className="flex items-baseline justify-between gap-4 border-b border-slate-800/60 pb-3">
      <div className="flex items-baseline gap-3">
        <h1 className="section-label">{tenant.name}</h1>
        <span className="text-slate-700">/</span>
        <span className="section-label-strong">Operations</span>
      </div>
      <div className="flex items-baseline gap-3 section-label">
        <span>{date}</span>
        <span className="text-slate-700">·</span>
        <span className="tabular-nums text-slate-300">{time}</span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-300">{user.full_name.split(" ")[0]}</span>
      </div>
    </header>
  );
}

function DashboardGrid({
  data,
  tab,
  slug,
  userId,
}: {
  data: DashboardResponse;
  tab: DashTab;
  slug: string;
  userId: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,18rem)]">
      <LiveFeed activity={data.recent_activity} slug={slug} tab={tab} userId={userId} />
      <div className="space-y-4">
        <MapPreview slug={slug} tab={tab} />
        <SystemPulseStrip data={data} slug={slug} tab={tab} />
      </div>
      <CockpitGauges data={data} slug={slug} tab={tab} />
    </div>
  );
}
