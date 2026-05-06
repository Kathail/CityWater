import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  addTask,
  logMaterial,
  logTime,
  transitionWorkOrder,
  updateTask,
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

  if (woQuery.isLoading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (woQuery.error) return <div className="p-8 text-red-600">{woQuery.error.message}</div>;
  const wo = woQuery.data!;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <header className="space-y-1">
        <Link to={`/${slug}/work-orders`} className="text-sm text-slate-500 hover:underline">
          ← Back to work orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{wo.wo_number}</h1>
            <p className="mt-1 text-base text-slate-700">{wo.title}</p>
            <p className="mt-1 text-xs text-slate-500">
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
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
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
          <dt className="text-slate-500">Asset</dt>
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
          <dt className="text-slate-500">Due</dt>
          <dd>{wo.due_by?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          <dt className="text-slate-500">Started</dt>
          <dd>{wo.started_at?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          <dt className="text-slate-500">Completed</dt>
          <dd>{wo.completed_at?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
        </dl>
        {wo.description && (
          <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{wo.description}</p>
        )}
      </Section>

      <TasksSection wo={wo} />
      <TimeSection wo={wo} />
      <MaterialsSection wo={wo} />
      <AttachmentsSection wo={wo} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: WoStatus }) {
  const colors: Record<WoStatus, string> = {
    draft: "bg-slate-200 text-slate-700",
    open: "bg-blue-100 text-blue-800",
    assigned: "bg-purple-100 text-purple-800",
    in_progress: "bg-amber-100 text-amber-800",
    on_hold: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-slate-200 text-slate-500 line-through",
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
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={!newTitle.trim() || add.isPending}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Section>
  );
}

function TimeSection({ wo }: { wo: WorkOrderDetail }) {
  const queryClient = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const log = useMutation({
    mutationFn: () =>
      logTime(wo.wo_number, {
        started_at: new Date(start).toISOString(),
        ended_at: new Date(end).toISOString(),
      }),
    onSuccess: () => {
      setStart("");
      setEnd("");
      queryClient.invalidateQueries({ queryKey: ["work-order", wo.wo_number] });
    },
  });

  const totalHours = wo.time_logs
    .reduce((acc, t) => acc + Number(t.hours_decimal || 0), 0)
    .toFixed(2);

  return (
    <Section title={`Time (${totalHours} h)`}>
      {wo.time_logs.length > 0 && (
        <ul className="text-sm space-y-1 mb-3">
          {wo.time_logs.map((t) => (
            <li key={t.id} className="text-slate-700">
              {t.started_at.slice(0, 16).replace("T", " ")} →{" "}
              {t.ended_at.slice(0, 16).replace("T", " ")}
              <span className="text-slate-500 ml-2">{t.hours_decimal} h</span>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (start && end) log.mutate();
        }}
        className="flex gap-2 items-end"
      >
        <label className="block">
          <span className="text-xs text-slate-600">Start</span>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">End</span>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!start || !end || log.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Log time
        </button>
      </form>
    </Section>
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
            <li key={m.id} className="text-slate-700 flex justify-between">
              <span>
                {m.quantity} × {m.description}
                {m.unit_cost && <span className="ml-2 text-slate-500">@ ${m.unit_cost}</span>}
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
          <span className="text-xs text-slate-600">Description</span>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Qty</span>
          <input
            type="number"
            step="0.1"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Unit cost</span>
          <input
            type="number"
            step="0.01"
            value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
            className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!form.description || !form.quantity || log.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
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
            <li key={a.id} className="text-slate-700">
              <span className="font-mono text-xs text-slate-500">{a.kind}</span>{" "}
              {a.original_filename}{" "}
              <span className="text-xs text-slate-500">
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
      {upload.isPending && <p className="mt-2 text-xs text-slate-500">Uploading…</p>}
    </Section>
  );
}
