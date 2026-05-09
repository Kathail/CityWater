import { Link } from "react-router-dom";
import { DashCard } from "./DashCard";
import { cleanActivitySummary, entityMeta, relativeTime } from "./helpers";
import type { DashboardResponse } from "./api";

/**
 * Most-recent comments + status transitions across the tenant's
 * entities.
 *
 * Iteration-3 refinements:
 * - The whole row is a single link target (was: only the chip linked,
 *   easy to miss). Hover reveals an explicit "Open →" so the next
 *   action is obvious without guessing.
 * - The kind ("comment" / "status change") is rendered as a small
 *   coloured icon-chip rather than tiny grey text, so the eye can
 *   scan a column to spot status transitions vs human comments.
 * - Items still group by day (Today / Yesterday / Earlier) so recency
 *   is always available without per-row timestamp parsing.
 *
 * Backend resolves the internal id → human-readable code (`wo_number`,
 * `sr_number`, `inspection_number`) and ships it on each row, so we
 * deep-link into the entity detail page. When `entity_code` is null
 * (entity soft-deleted, etc.) we fall back to the list page.
 */

const ENTITY_CHIP: Record<"wo" | "sr" | "ins", string> = {
  wo: "bg-blue-500/15 text-blue-200 ring-blue-500/30",
  sr: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  ins: "bg-purple-500/15 text-purple-200 ring-purple-500/30",
};

const KIND_CHIP: Record<"comment" | "transition", { glyph: string; cls: string; label: string }> = {
  comment: {
    glyph: "“",
    cls: "bg-slate-700/70 text-slate-200",
    label: "Comment",
  },
  transition: {
    glyph: "→",
    cls: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20",
    label: "Status change",
  },
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
              <ol className="space-y-0.5">
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
  const meta = entityMeta(slug, item.entity_type, item.entity_code);
  const kind =
    item.kind === "comment" || item.kind === "transition"
      ? KIND_CHIP[item.kind]
      : KIND_CHIP.comment;
  return (
    <li>
      <Link
        to={meta.href}
        className="group/row flex items-start gap-2 rounded px-1.5 py-1.5 text-sm transition-colors hover:bg-slate-800/50"
      >
        <span
          className={`mt-0.5 inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${ENTITY_CHIP[meta.tone]}`}
          aria-hidden="true"
        >
          {meta.label}
        </span>
        <span
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[12px] leading-none ${kind.cls}`}
          aria-label={kind.label}
          title={kind.label}
        >
          {kind.glyph}
        </span>
        <span className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-slate-200">
            {cleanActivitySummary(item.summary)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">{relativeTime(item.occurred_at)}</p>
        </span>
        <span
          aria-hidden="true"
          className="mt-1 text-[11px] text-slate-600 opacity-0 transition-opacity group-hover/row:opacity-100"
        >
          Open →
        </span>
      </Link>
    </li>
  );
}

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
