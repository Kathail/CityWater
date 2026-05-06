import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { LinkedItems } from "../links/LinkedItems";
import { ProcedureRunner } from "../tasks/ProcedureRunner";
import { getTaskDefinition, type TaskDefinitionRead } from "../tasks/api";
import { TaskFormRenderer, type TaskData } from "../tasks/TaskFormRenderer";
import {
  addTask,
  logMaterial,
  logTime,
  transitionWorkOrder,
  updateTask,
  updateWorkOrder,
  uploadAttachment,
  type WoStatus,
  type WorkOrderDetail,
} from "./api";
import { useWorkOrder } from "./hooks";

const TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["assigned", "on_hold", "cancelled"],
  assigned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["completed", "on_hold"],
  on_hold: ["open", "assigned", "in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export function WorkOrderDetailPage() {
  const { slug, wo: woNumber } = useParams<{ slug: string; wo: string }>();
  const queryClient = useQueryClient();
  const woQuery = useWorkOrder(woNumber);

  const transition = useMutation({
    mutationFn: (to: WoStatus) => transitionWorkOrder(woNumber!, to),
    onSuccess: (next) => {
      queryClient.setQueryData(["work-order", woNumber], next);
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  const taskCode = woQuery.data?.task_definition_code ?? null;
  const taskQuery = useQuery<TaskDefinitionRead, Error>({
    queryKey: ["task-definition", taskCode],
    queryFn: () => getTaskDefinition(taskCode!),
    enabled: !!taskCode,
  });

  if (woQuery.isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (woQuery.error) return <div className="p-8 text-red-400">{woQuery.error.message}</div>;
  const wo = woQuery.data!;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <header className="space-y-1">
        <Link to={`/${slug}/work-orders`} className="text-sm text-slate-400 hover:underline">
          ← Back to work orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">{wo.wo_number}</h1>
            <p className="mt-1 text-base text-slate-200">{wo.title}</p>
            <p className="mt-1 text-xs text-slate-400">
              {wo.type} · {wo.category} · {wo.priority}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusPill status={wo.status} />
            <div className="flex gap-1">
              {TRANSITIONS[wo.status].map((to) => (
                <button
                  key={to}
                  onClick={() => transition.mutate(to)}
                  disabled={transition.isPending}
                  className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800"
                >
                  → {to}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <Section title="Details">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-slate-400">Asset</dt>
          <dd>
            {wo.asset_uid ? (
              <Link
                to={`/${slug}/assets/${wo.asset_uid}`}
                className="font-mono text-xs hover:underline"
              >
                {wo.asset_uid}
              </Link>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-slate-400">Due</dt>
          <dd>{wo.due_by?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          <dt className="text-slate-400">Started</dt>
          <dd>{wo.started_at?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          <dt className="text-slate-400">Completed</dt>
          <dd>{wo.completed_at?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
        </dl>
        {wo.description && (
          <p className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">{wo.description}</p>
        )}
      </Section>

      {taskQuery.data && (
        <TaskSection
          task={taskQuery.data}
          wo={wo}
          slug={slug}
          onChange={(next) => queryClient.setQueryData(
            ["work-order", woNumber],
            { ...wo, task_data: next },
          )}
        />
      )}

      <TasksSection wo={wo} />
      <TimeSection wo={wo} />
      <MaterialsSection wo={wo} />
      <AttachmentsSection wo={wo} />
      <LinkedItems entityType="work_order" entityId={wo.id} />
      <ActivityTimeline
        entityType="work_order"
        entityId={wo.id}
        task={taskQuery.data}
        taskData={wo.task_data}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Renders the task definition's form so the operator can fill in
 * task_data. Local state drives the UI (so the smart-comment chips on
 * the activity composer update reactively as the operator types). A
 * debounced PATCH persists changes to the backend.
 */
function TaskSection({
  task,
  wo,
  slug,
  onChange,
}: {
  task: TaskDefinitionRead;
  wo: WorkOrderDetail;
  slug: string | undefined;
  onChange: (next: TaskData) => void;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<TaskData>(wo.task_data);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If the WO refetches with new task_data, sync local state.
  useEffect(() => {
    setData(wo.task_data);
  }, [wo.task_data]);

  const save = useMutation({
    mutationFn: (next: TaskData) =>
      updateWorkOrder(wo.wo_number, { task_data: next }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["work-order", wo.wo_number], updated);
      setSavedAt(new Date());
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleChange(next: TaskData) {
    setData(next);
    onChange(next); // keeps chip render in lockstep with the form
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save.mutate(next), 600);
  }

  return (
    <Section title="Task">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-base text-slate-100">{task.title}</p>
          {task.summary && (
            <p className="mt-1 text-xs text-slate-400">{task.summary}</p>
          )}
        </div>
        <Link
          to={`/${slug}/admin/task-definitions`}
          className="font-mono text-xs text-slate-400 hover:text-blue-300 hover:underline"
        >
          {task.code} · v{task.version}
        </Link>
      </div>

      {task.form.length > 0 && (
        <div className="mt-4">
          <TaskFormRenderer task={task} value={data} onChange={handleChange} />
        </div>
      )}

      {(task.procedure?.steps?.length ?? 0) > 0 && (
        <div className="mt-4">
          <ProcedureRunner task={task} taskData={data} onChange={handleChange} />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        {save.isPending && <span>Saving…</span>}
        {!save.isPending && savedAt && (
          <span>Saved {savedAt.toLocaleTimeString()}</span>
        )}
        {error && <span className="text-red-400">Save failed: {error}</span>}
      </div>
    </Section>
  );
}

function StatusPill({ status }: { status: WoStatus }) {
  const colors: Record<WoStatus, string> = {
    draft: "bg-slate-700/40 text-slate-300 ring-1 ring-slate-600/40",
    open: "bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30",
    assigned: "bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/30",
    in_progress: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30",
    on_hold: "bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30",
    completed: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30",
    cancelled: "bg-slate-800 text-slate-500 ring-1 ring-slate-700 line-through",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status]}`}>{status}</span>
  );
}

function TasksSection({ wo }: { wo: WorkOrderDetail }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const add = useMutation({
    mutationFn: () => addTask(wo.wo_number, newTitle),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });
  const toggle = useMutation({
    mutationFn: (t: { id: number; complete: boolean }) =>
      updateTask(wo.wo_number, t.id, { is_complete: t.complete }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });

  return (
    <Section title="Tasks">
      <ul className="space-y-1">
        {wo.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={t.is_complete}
              onChange={(e) => toggle.mutate({ id: t.id, complete: e.target.checked })}
            />
            <span className={t.is_complete ? "line-through text-slate-400" : ""}>{t.title}</span>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (newTitle.trim()) add.mutate();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded border border-slate-700 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={!newTitle.trim() || add.isPending}
          className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-400 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Section>
  );
}

/** Tablet-first time-log composer.
 *
 * Field crews mostly want to record "I worked 1h on this" not punch a
 * specific clock. Default UX:
 *   - Day chip (Today / Yesterday)
 *   - Duration chip (15m / 30m / 1h / 2h / 4h / 8h)
 *   - One tap on "Log time" stamps a row anchored to *now* minus duration.
 * Power users can flip to "Manual" to set explicit start/end ranges.
 */
function TimeSection({ wo }: { wo: WorkOrderDetail }) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState<"today" | "yesterday">("today");
  // Additive: each chip tap *adds* its value to the running total. Tap 30
  // then 15 to log 45m, or 2h then 30m for 2h 30m. Reset zeroes it.
  const [durationMins, setDurationMins] = useState<number>(0);
  const [manualMode, setManualMode] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const log = useMutation({
    mutationFn: (range: { started_at: string; ended_at: string }) =>
      logTime(wo.wo_number, range),
    onSuccess: () => {
      setStart("");
      setEnd("");
      setDurationMins(0);
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });

  function quickLog() {
    if (durationMins <= 0) return;
    const ended = new Date();
    if (day === "yesterday") {
      // Anchor to 4pm yesterday — typical end-of-shift, mirrors paper habit.
      ended.setDate(ended.getDate() - 1);
      ended.setHours(16, 0, 0, 0);
    }
    const started = new Date(ended.getTime() - durationMins * 60 * 1000);
    log.mutate({
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
    });
  }

  function manualLog(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return;
    log.mutate({
      started_at: new Date(start).toISOString(),
      ended_at: new Date(end).toISOString(),
    });
  }

  const totalHours = wo.time_logs
    .reduce((acc, t) => acc + Number(t.hours_decimal || 0), 0)
    .toFixed(2);

  return (
    <Section title={`Time (${totalHours} h)`}>
      {wo.time_logs.length > 0 && (
        <ul className="text-sm space-y-1 mb-3">
          {wo.time_logs.map((t) => (
            <li key={t.id} className="text-slate-200">
              {t.started_at.slice(0, 16).replace("T", " ")} →{" "}
              {t.ended_at.slice(0, 16).replace("T", " ")}
              <span className="text-slate-400 ml-2">{t.hours_decimal} h</span>
            </li>
          ))}
        </ul>
      )}

      {!manualMode ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Day
            </p>
            <div className="flex gap-2">
              {(["today", "yesterday"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm capitalize transition-colors ${
                    day === d
                      ? "bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/40"
                      : "bg-slate-900 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Duration
              </p>
              <p className="text-sm tabular-nums text-blue-300">
                {formatDuration(durationMins)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[15, 30, 60, 120, 240, 480].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDurationMins((d) => d + m)}
                  className="min-h-11 rounded-full bg-slate-900 px-4 py-2 text-sm text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-800 hover:ring-blue-500/40 active:bg-blue-500/15 active:ring-blue-500/60"
                >
                  +{m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
              {durationMins > 0 && (
                <button
                  type="button"
                  onClick={() => setDurationMins(0)}
                  className="min-h-11 rounded-full px-3 py-2 text-xs text-slate-400 hover:text-red-300"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setManualMode(true)}
              className="text-xs text-slate-400 hover:text-blue-300 hover:underline"
            >
              Manual range…
            </button>
            <button
              type="button"
              onClick={quickLog}
              disabled={log.isPending || durationMins <= 0}
              className="btn-primary min-h-11 px-5 py-2 text-sm"
            >
              {log.isPending
                ? "Logging…"
                : durationMins <= 0
                  ? "Tap a chip to add time"
                  : `Log ${formatDuration(durationMins)} ${day}`}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={manualLog} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="block flex-1 min-w-48">
              <span className="text-xs text-slate-300">Start</span>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block flex-1 min-w-48">
              <span className="text-xs text-slate-300">End</span>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                {
                  label: "Now",
                  fn: () => {
                    setEnd(toLocalInput(new Date()));
                  },
                },
                {
                  label: "Started 1 h ago",
                  fn: () => setStart(toLocalInput(new Date(Date.now() - 60 * 60_000))),
                },
                {
                  label: "Started 30 m ago",
                  fn: () => setStart(toLocalInput(new Date(Date.now() - 30 * 60_000))),
                },
              ] as const
            ).map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.fn}
                className="min-h-11 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setManualMode(false)}
              className="text-xs text-slate-400 hover:text-blue-300 hover:underline"
            >
              ← Quick log
            </button>
            <button
              type="submit"
              disabled={!start || !end || log.isPending}
              className="btn-primary min-h-11 px-5 py-2 text-sm"
            >
              {log.isPending ? "Logging…" : "Log time"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function formatDuration(mins: number): string {
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function toLocalInput(d: Date): string {
  // datetime-local needs YYYY-MM-DDTHH:MM in *local* time, not ISO.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function MaterialsSection({ wo }: { wo: WorkOrderDetail }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ description: "", quantity: "", unit_cost: "" });
  const log = useMutation({
    mutationFn: () =>
      logMaterial(wo.wo_number, {
        description: form.description,
        quantity: form.quantity,
        unit_cost: form.unit_cost || undefined,
      }),
    onSuccess: () => {
      setForm({ description: "", quantity: "", unit_cost: "" });
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });

  return (
    <Section title={`Materials${wo.materials_total ? ` ($${wo.materials_total})` : ""}`}>
      {wo.materials.length > 0 && (
        <ul className="text-sm space-y-1 mb-3">
          {wo.materials.map((m) => (
            <li key={m.id} className="text-slate-200 flex justify-between">
              <span>
                {m.quantity} × {m.description}
                {m.unit_cost && <span className="ml-2 text-slate-400">@ ${m.unit_cost}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.description && form.quantity) log.mutate();
        }}
        className="flex flex-wrap gap-2 items-end"
      >
        <label className="block flex-1 min-w-48">
          <span className="text-xs text-slate-300">Description</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-300">Qty</span>
          <input
            type="number"
            step="0.1"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            className="mt-1 block w-20 rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-300">Unit cost</span>
          <input
            type="number"
            step="0.01"
            value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
            className="mt-1 block w-24 rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!form.description || !form.quantity || log.isPending}
          className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Section>
  );
}

function AttachmentsSection({ wo }: { wo: WorkOrderDetail }) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (f: File) =>
      uploadAttachment(wo.wo_number, f, f.type.startsWith("image/") ? "photo" : "doc"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });
  return (
    <Section title="Attachments">
      {wo.attachments.length > 0 && (
        <ul className="text-sm space-y-1 mb-3">
          {wo.attachments.map((a) => (
            <li key={a.id} className="text-slate-200">
              <span className="font-mono text-xs text-slate-400">{a.kind}</span>{" "}
              {a.original_filename}{" "}
              <span className="text-xs text-slate-400">
                ({(a.size_bytes / 1024).toFixed(1)} KB)
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        type="file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
        }}
        className="text-sm"
      />
      {upload.isPending && <p className="mt-2 text-xs text-slate-400">Uploading…</p>}
    </Section>
  );
}
