import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Dash } from "../../components/Dash";
import { ErrorState, LoadingState } from "../../components/States";
import { StatusPill as SharedStatusPill } from "../../components/StatusPill";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { formatDateTime } from "../../lib/format";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { LinkedItems } from "../links/LinkedItems";
import { AreaChips } from "../tasks/AreaChips";
import { ProcedureRunner } from "../tasks/ProcedureRunner";
import { getTaskDefinition, type TaskDefinitionRead } from "../tasks/api";
import { TaskFormRenderer, type TaskData } from "../tasks/TaskFormRenderer";
import { RouteSection } from "./RouteSection";
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
import { WO_STATUS_TONE, WO_TRANSITIONS as TRANSITIONS } from "./tones";

/** Single-letter hotkey per destination status. Letters are stable so
 * a returning operator's muscle memory works across WOs. Avoid
 * collisions with each from-state's transition set in `tones.ts`. */
const WO_HOTKEY: Record<WoStatus, string> = {
  draft: "d",
  open: "o",
  assigned: "a",
  in_progress: "i",
  on_hold: "h",
  completed: "c",
  cancelled: "x",
};

export function WorkOrderDetailPage() {
  const { slug, wo: woNumber } = useParams<{ slug: string; wo: string }>();
  const queryClient = useQueryClient();
  const woQuery = useWorkOrder(woNumber);

  // Per-stop entries the operator just ticked complete in this session.
  // `comment` is the rendered narrative (from the task definition's
  // smart_comments + that stop's task_data) when available, otherwise
  // null so the chip strip can fall back to the bare UID.
  const [pendingAssetRefs, setPendingAssetRefs] = useState<
    { asset_uid: string; comment: string | null }[]
  >([]);
  const recordCompletedAsset = (asset_uid: string, comment: string | null) =>
    setPendingAssetRefs((prev) =>
      prev.some((p) => p.asset_uid === asset_uid) ? prev : [...prev, { asset_uid, comment }],
    );
  const clearPendingAssetRefs = () => setPendingAssetRefs([]);

  const transition = useMutation({
    mutationFn: (to: WoStatus) => transitionWorkOrder(woNumber!, to),
    onSuccess: (next) => {
      queryClient.setQueryData(["work-order", woNumber], next);
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  // Single-letter hotkeys for status transitions. Skips when the user
  // is typing in an input/textarea/contenteditable/select so it doesn't
  // hijack their keystrokes mid-comment.
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (!woQuery.data) return;
      const allowed = TRANSITIONS[woQuery.data.status];
      const target = allowed.find((s) => WO_HOTKEY[s] === e.key.toLowerCase());
      if (!target) return;
      e.preventDefault();
      transition.mutate(target);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [woQuery.data, transition]);

  const taskCode = woQuery.data?.task_definition_code ?? null;
  const taskQuery = useQuery<TaskDefinitionRead, Error>({
    queryKey: ["task-definition", taskCode],
    queryFn: () => getTaskDefinition(taskCode!),
    enabled: !!taskCode,
  });

  if (woQuery.isLoading) return <LoadingState />;
  if (woQuery.error)
    return <ErrorState message={woQuery.error.message} retry={() => woQuery.refetch()} />;
  const wo = woQuery.data!;

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-4xl">
      <header className="space-y-1">
        <Link
          to={
            // Restore the filters the operator was viewing (?scope=mine,
            // ?overdue=1, etc.) when they clicked into this WO. Falls
            // back to the unfiltered list on first visit / after the
            // tab is re-opened. The list page writes this on every render.
            sessionStorage.getItem("wo-list-referrer") ?? `/${slug}/work-orders`
          }
          className="text-sm text-slate-400 hover:underline"
        >
          ← Back to work orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">{wo.wo_number}</h1>
            <p className="mt-1 text-base text-slate-200">{wo.title}</p>
            <p className="mt-1 text-xs text-slate-400">
              {wo.type} · {wo.category} · {wo.priority}
            </p>
            <AreaChips areas={wo.areas} domain={taskQuery.data?.default_domain} className="mt-2" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusPill status={wo.status} />
            <div className="flex flex-wrap justify-end gap-1">
              {TRANSITIONS[wo.status].map((to) => {
                const hotkey = WO_HOTKEY[to];
                return (
                  <Button
                    key={to}
                    variant="ghost"
                    size="sm"
                    onClick={() => transition.mutate(to)}
                    disabled={transition.isPending}
                    aria-label={`Transition to ${to.replace("_", " ")} (shortcut ${hotkey?.toUpperCase()})`}
                    title={hotkey ? `Shortcut: ${hotkey.toUpperCase()}` : undefined}
                  >
                    → {to.replace("_", " ")}
                    {hotkey && (
                      <kbd className="ml-2 rounded bg-slate-800 px-1 text-[10px] font-mono text-slate-400">
                        {hotkey.toUpperCase()}
                      </kbd>
                    )}
                  </Button>
                );
              })}
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
              <Dash />
            )}
          </dd>
          <dt className="text-slate-400">Due</dt>
          <dd>{formatDateTime(wo.due_by) || <Dash />}</dd>
          <dt className="text-slate-400">Started</dt>
          <dd>{formatDateTime(wo.started_at) || <Dash />}</dd>
          <dt className="text-slate-400">Completed</dt>
          <dd>{formatDateTime(wo.completed_at) || <Dash />}</dd>
        </dl>
        {wo.description && (
          <p className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">{wo.description}</p>
        )}
      </Section>

      {taskQuery.data && <TaskSection task={taskQuery.data} wo={wo} slug={slug} />}

      <RouteSection
        wo={wo}
        slug={slug}
        task={taskQuery.data}
        onAssetCompleted={recordCompletedAsset}
      />

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
        pendingAssetRefs={pendingAssetRefs}
        onClearPendingAssetRefs={clearPendingAssetRefs}
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
 * Renders the task definition's form + procedure runner. State flows
 * top-down from the React Query cache: every change writes the new
 * task_data to the cache (via `queryClient.setQueryData`) so the chips
 * + checklist react instantly, and a debounced PATCH persists to the
 * server. There is intentionally no local state copy of task_data —
 * that pattern was creating sync bugs where local state and the cache
 * could diverge.
 */
function TaskSection({
  task,
  wo,
  slug,
}: {
  task: TaskDefinitionRead;
  wo: WorkOrderDetail;
  slug: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks "user edited but server hasn't acknowledged yet" — covers both
  // the 600 ms debounce window and the in-flight save. The
  // UnsavedChangesGuard reads this so navigation away during either
  // window prompts before discarding.
  const [pendingSave, setPendingSave] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the debounce timer on unmount so a fast-fingered user can't
  // navigate away mid-debounce and still trigger a setState on a
  // freed component (WO-P1-7). UnsavedChangesGuard prompts on route
  // change, but tab close doesn't go through it.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  const save = useMutation({
    mutationFn: (next: TaskData) => updateWorkOrder(wo.wo_number, { task_data: next }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["work-order", wo.wo_number], updated);
      setSavedAt(new Date());
      setError(null);
      setPendingSave(false);
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingSave(false);
    },
  });

  function handleChange(next: TaskData) {
    // Optimistic cache write — instant UI update for the form, the
    // procedure checkboxes, the smart-comment chips, and the checklist
    // draft (all of which read wo.task_data through the same cache).
    queryClient.setQueryData<WorkOrderDetail>(["work-order", wo.wo_number], (prev) =>
      prev ? { ...prev, task_data: next } : prev,
    );
    setPendingSave(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save.mutate(next), 600);
  }

  return (
    <Section title="Task">
      <UnsavedChangesGuard
        dirty={pendingSave || save.isPending}
        title="Leave with unsaved task edits?"
        message="Your last task edit hasn't synced to the server yet. Leave anyway and lose it?"
      />
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-base text-slate-100">{task.title}</p>
          {task.summary && <p className="mt-1 text-xs text-slate-400">{task.summary}</p>}
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
          <TaskFormRenderer task={task} value={wo.task_data} onChange={handleChange} />
        </div>
      )}

      {(task.procedure?.steps?.length ?? 0) > 0 && (
        <div className="mt-4">
          <ProcedureRunner task={task} taskData={wo.task_data} onChange={handleChange} />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        {save.isPending && <span>Saving…</span>}
        {!save.isPending && savedAt && <span>Saved {savedAt.toLocaleTimeString()}</span>}
      </div>
      {error && (
        <div className="mt-2">
          <Alert>Save failed: {error}</Alert>
        </div>
      )}
    </Section>
  );
}

function StatusPill({ status }: { status: WoStatus }) {
  return (
    <SharedStatusPill tone={WO_STATUS_TONE[status]} dot>
      {status.replace("_", " ")}
    </SharedStatusPill>
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
    <Section title="Sub-tasks">
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
        <Button type="submit" size="sm" disabled={!newTitle.trim() || add.isPending}>
          Add
        </Button>
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
    mutationFn: (range: { started_at: string; ended_at: string }) => logTime(wo.wo_number, range),
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
              {formatDateTime(t.started_at)} → {formatDateTime(t.ended_at)}
              <span className="text-slate-400 ml-2">{t.hours_decimal} h</span>
            </li>
          ))}
        </ul>
      )}

      {!manualMode ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Day</p>
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
              <p className="text-xs uppercase tracking-wider text-slate-500">Duration</p>
              <p className="text-sm tabular-nums text-blue-300">{formatDuration(durationMins)}</p>
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
        <Button
          type="submit"
          size="sm"
          disabled={!form.description || !form.quantity || log.isPending}
        >
          Add
        </Button>
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
