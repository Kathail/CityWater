import { DashCard } from "./DashCard";
import type { DashboardResponse } from "./api";

/** Horizontal bar chart of WO categories over the last 30 days. */
export function CategoryChart({
  buckets,
}: {
  buckets: DashboardResponse["wo_by_category_30d"];
}) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <DashCard
      title="Work by category"
      trailing={<span className="text-xs tabular-nums text-slate-500">30d · {total}</span>}
    >
      {buckets.length === 0 ? (
        <p className="text-sm text-slate-500">No work logged in the last 30 days.</p>
      ) : (
        <ul className="space-y-1.5">
          {buckets.map((b) => {
            const pct = total === 0 ? 0 : (b.count / total) * 100;
            return (
              <li key={b.category} className="text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="capitalize text-[13px] text-slate-200">
                    {b.category.replace(/_/g, " ")}
                  </span>
                  <span
                    className="tabular-nums text-[11px] text-slate-400"
                    title={`${pct.toFixed(0)}% of work`}
                  >
                    {b.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-500/60"
                    style={{ width: `${(b.count / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
