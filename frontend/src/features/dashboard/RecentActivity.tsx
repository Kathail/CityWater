import { Link } from "react-router-dom";
import { DashCard } from "./DashCard";
import { cleanActivitySummary, entityMeta, relativeTime } from "./helpers";
import type { DashboardResponse } from "./api";

/**
 * Most-recent comments + status transitions across the tenant's
 * entities. Iteration-2 refinements:
 *
 * - Wrapped in <DashCard> for chrome consistency.
 * - Items now group by day (Today / Yesterday / earlier) so the
 *   eye can find recent activity without scanning timestamps.
 * - Strips the legacy "[sim]" prefix.
 * - The entity-type chip is colour-coded and links into the matching
 *   list page (WO / SR / INS).
 */

const ENTITY_CHIP: Record<"wo" | "sr" | "ins", string> = {
  wo: "bg-blue-500/15 text-blue-200 ring-blue-500/30",
  sr: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  ins: "bg-purple-500/15 text-purple-200 ring-purple-500/30",
};

interface ItemProps {
  item: DashboardResponse["recent_activity"][number];
  slug: string;
}

export function RecentActivity({
  items,
  slug,
}: {
  items: DashboardResponse["recent_activity"];
  slug: string;
}) {
  const grouped = groupByDay(items);

  return (
    <DashCard title="Recent activity">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Quiet last 48 hours.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {g.label}
              </p>
              <ol className="space-y-1.5">
                {g.items.map((item, i) => (
                  <ActivityRow key={i} item={item} slug={slug} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  );
}

function ActivityRow({ item, slug }: ItemProps) {
  const meta = entityMeta(slug, item.entity_type);
  return (
    <li className="flex gap-2.5 text-sm">
      <Link
        to={meta.href}
        className={`mt-0.5 inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${ENTITY_CHIP[meta.tone]}`}
        aria-label={`View ${meta.label} list`}
      >
        {meta.label}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-slate-200">
          {cleanActivitySummary(item.summary)}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {item.kind === "comment" ? "comment" : "status change"} ·{" "}
          {relativeTime(item.occurred_at)}
        </p>
      </div>
    </li>
  );
}

/**
 * Bucket activity items into Today / Yesterday / earlier groups.
 * Stable: Date.now() captured once per render so all items in the
 * group share the same "now" reference.
 */
function groupByDay(items: DashboardResponse["recent_activity"]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const today: typeof items = [];
  const yesterday: typeof items = [];
  const earlier: typeof items = [];

  for (const item of items) {
    const t = new Date(item.occurred_at).getTime();
    if (t >= todayStart) today.push(item);
    else if (t >= yesterdayStart) yesterday.push(item);
    else earlier.push(item);
  }

  const groups: { label: string; items: typeof items }[] = [];
  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (earlier.length) groups.push({ label: "Earlier", items: earlier });
  return groups;
}
