import { useState } from "react";
import { ApiError } from "../../lib/apiClient";
import { CreateScheduleDialog } from "./CreateScheduleDialog";
import { type ScheduleRead } from "./api";
import {
  useDeleteSchedule,
  useSchedules,
  useTickSchedules,
  useUpdateSchedule,
} from "./hooks";

export function SchedulesPage() {
  const query = useSchedules();
  const [createOpen, setCreateOpen] = useState(false);
  const [tickResult, setTickResult] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const tick = useTickSchedules();

  async function fireTick() {
    setTickResult(null);
    setTickError(null);
    try {
      const r = await tick.mutateAsync();
      setTickResult(
        `Fired ${r.fired} of ${r.schedules_processed} due schedule${r.schedules_processed === 1 ? "" : "s"}` +
          (r.instances.length ? ` — created ${r.instances.join(", ")}` : ""),
      );
    } catch (err) {
      setTickError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="p-8 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Schedules</h1>
          <p className="text-sm text-slate-400">
            Recurring work orders + inspections, expressed as iCalendar RRULE.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fireTick}
            disabled={tick.isPending}
            className="btn-ghost px-3 py-1.5 text-sm"
            title="Manually fire any due schedules"
          >
            {tick.isPending ? "Ticking…" : "Run tick now"}
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary px-3 py-1.5 text-sm">
            + New schedule
          </button>
        </div>
      </header>

      {tickResult && (
        <p className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200">
          {tickResult}
        </p>
      )}
      {tickError && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {tickError}
        </p>
      )}

      {query.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {query.isError && (
        <p className="text-sm text-red-400">Failed to load schedules.</p>
      )}

      {query.data && (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/40 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">RRULE</th>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Next run</th>
                <th className="px-3 py-2">Last run</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {query.data.items.map((s) => (
                <Row key={s.id} schedule={s} />
              ))}
              {query.data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-sm text-slate-500">
                    No schedules yet. Click "New schedule" to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateScheduleDialog onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function Row({ schedule }: { schedule: ScheduleRead }) {
  const update = useUpdateSchedule(schedule.id);
  const remove = useDeleteSchedule();
  return (
    <tr>
      <td className="px-3 py-2">
        <div className="text-slate-100">{schedule.name}</div>
        {schedule.description && (
          <div className="text-xs text-slate-500">{schedule.description}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs ring-1 ${
            schedule.kind === "work_order"
              ? "bg-blue-500/15 text-blue-200 ring-blue-500/30"
              : "bg-violet-500/15 text-violet-200 ring-violet-500/30"
          }`}
        >
          {schedule.kind === "work_order" ? "WO" : "Inspection"}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-300">{schedule.rrule}</td>
      <td className="px-3 py-2 font-mono text-xs text-slate-400">
        {schedule.asset_uid ?? "—"}
      </td>
      <td className="px-3 py-2 text-xs text-slate-300">
        {schedule.next_run_at
          ? new Date(schedule.next_run_at).toLocaleString()
          : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {schedule.last_run_at
          ? new Date(schedule.last_run_at).toLocaleString()
          : "never"}
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => update.mutate({ active: !schedule.active })}
          className={`text-xs ${schedule.active ? "text-emerald-300" : "text-slate-500"} hover:underline`}
        >
          {schedule.active ? "active" : "paused"}
        </button>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => {
            if (window.confirm(`Delete schedule "${schedule.name}"?`)) {
              remove.mutate(schedule.id);
            }
          }}
          className="text-xs text-red-300 hover:text-red-200 hover:underline"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
