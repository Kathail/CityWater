import { DashCard } from "./DashCard";
import type { DashboardResponse } from "./api";

/** 7-day completed-work sparkline. */
export function ThroughputSpark({
  series,
  totalThisWeek,
}: {
  series: DashboardResponse["throughput_7d"];
  totalThisWeek: number;
}) {
  const max = Math.max(1, ...series.map((d) => d.completed));
  return (
    <DashCard
      title="7-day throughput"
      trailing={
        <span className="text-lg font-semibold tabular-nums text-emerald-300">
          {totalThisWeek}
        </span>
      }
    >
      <div
        className="flex h-12 items-end gap-1"
        role="img"
        aria-label="Daily completed work for the past 7 days"
      >
        {series.map((d) => {
          const h = Math.max(2, (d.completed / max) * 100);
          const dayLabel = new Date(d.date).toLocaleDateString(undefined, { weekday: "short" });
          return (
            <div
              key={d.date}
              className="flex flex-1 flex-col items-center justify-end gap-1"
              title={`${dayLabel}: ${d.completed} completed`}
            >
              <div
                className="w-full rounded-t bg-emerald-500/40 hover:bg-emerald-500/70"
                style={{ height: `${h}%` }}
              />
              <span className="text-[9px] uppercase text-slate-500">{dayLabel.slice(0, 1)}</span>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}
