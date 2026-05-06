import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { LinkedItems } from "../links/LinkedItems";
import { ProcedureRunner } from "../tasks/ProcedureRunner";
import { getTaskDefinition, type TaskDefinitionRead } from "../tasks/api";
import { TaskFormRenderer, type TaskData } from "../tasks/TaskFormRenderer";
import { DispatchDialog } from "./DispatchDialog";
import type { SrClosureReason } from "./api";
import { useServiceRequest, useUpdateServiceRequest } from "./hooks";

const CLOSURE_REASONS: SrClosureReason[] = [
  "resolved",
  "duplicate",
  "no_action",
  "false_alarm",
  "deferred",
];

export function ServiceRequestDetailPage() {
  const { slug, sr } = useParams<{ slug: string; sr: string }>();
  const navigate = useNavigate();
  const query = useServiceRequest(sr);
  const update = useUpdateServiceRequest(sr ?? "");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState<SrClosureReason>("resolved");
  const [closeNotes, setCloseNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const taskCode = query.data?.task_definition_code ?? null;
  const taskQuery = useQuery<TaskDefinitionRead, Error>({
    queryKey: ["task-definition", taskCode],
    queryFn: () => getTaskDefinition(taskCode!),
    enabled: !!taskCode,
  });

  // Local copy of task_data so the form drives chip rendering without
  // round-tripping through the server on every keystroke.
  const [taskData, setTaskData] = useState<TaskData>(query.data?.task_data ?? {});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (query.data?.task_data) setTaskData(query.data.task_data);
  }, [query.data?.task_data]);

  if (query.isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (query.isError) return <div className="p-8 text-red-400">Failed to load.</div>;
  if (!query.data) return null;

  const data = query.data;

  function handleTaskChange(next: TaskData) {
    setTaskData(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      update.mutate(
        { task_data: next },
        { onSuccess: () => setSavedAt(new Date()) },
      );
    }, 600);
  }

  async function transition(status: "triaged" | "closed") {
    setErrorMessage(null);
    try {
      if (status === "closed") {
        await update.mutateAsync({
          status: "closed",
          closure_reason: closeReason,
          closure_notes: closeNotes || null,
        });
        setCloseOpen(false);
      } else {
        await update.mutateAsync({ status });
      }
    } catch (err) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage(String(err));
    }
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">
            {data.sr_number}
          </h1>
          <p className="text-sm text-slate-400">
            {data.category} · {data.domain} ·{" "}
            <span className="font-medium">{data.status}</span> · priority {data.priority}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === "new" && (
            <button
              onClick={() => transition("triaged")}
              disabled={update.isPending}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800/50 disabled:opacity-50"
            >
              Mark triaged
            </button>
          )}
          {!["closed", "duplicate", "dispatched"].includes(data.status) && (
            <button
              onClick={() => setDispatchOpen(true)}
              className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400"
            >
              Dispatch as work order
            </button>
          )}
          {!["closed", "duplicate"].includes(data.status) && (
            <button
              onClick={() => setCloseOpen(true)}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800/50"
            >
              Close
            </button>
          )}
        </div>
      </header>

      {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Caller</h2>
          <Field label="Name" value={data.caller_name} />
          <Field label="Phone" value={data.caller_phone} />
          <Field label="Email" value={data.caller_email} />
          <Field label="Reported" value={new Date(data.reported_at).toLocaleString()} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Location</h2>
          <Field label="Address" value={data.reported_address} />
          {data.location && (
            <p className="text-sm text-slate-200">
              {data.location.coordinates[0].toFixed(5)},{" "}
              {data.location.coordinates[1].toFixed(5)}
            </p>
          )}
          {data.work_order_number && (
            <p className="text-sm">
              <span className="text-slate-400">Linked WO: </span>
              <Link
                to={`/${slug}/work-orders/${data.work_order_number}`}
                className="text-slate-100 hover:underline"
              >
                {data.work_order_number}
              </Link>
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Description</h2>
        <p className="whitespace-pre-line text-sm text-slate-100">
          {data.description ?? <span className="text-slate-400">none</span>}
        </p>
      </section>

      {data.closure_reason && (
        <section className="space-y-2 rounded border border-slate-800 bg-slate-800/50 p-4">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Closure</h2>
          <p className="text-sm text-slate-100">
            <span className="font-medium">{data.closure_reason}</span>
            {data.closed_at && (
              <span className="text-slate-400">
                {" — "}
                {new Date(data.closed_at).toLocaleString()}
              </span>
            )}
          </p>
          {data.closure_notes && (
            <p className="whitespace-pre-line text-sm text-slate-200">
              {data.closure_notes}
            </p>
          )}
        </section>
      )}

      {taskQuery.data && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">
            Task
          </h2>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-base text-slate-100">{taskQuery.data.title}</p>
              {taskQuery.data.summary && (
                <p className="mt-1 text-xs text-slate-400">{taskQuery.data.summary}</p>
              )}
            </div>
            <Link
              to={`/${slug}/admin/task-definitions`}
              className="font-mono text-xs text-slate-400 hover:text-blue-300 hover:underline"
            >
              {taskQuery.data.code} · v{taskQuery.data.version}
            </Link>
          </div>
          {taskQuery.data.form.length > 0 && (
            <div className="mt-4">
              <TaskFormRenderer
                task={taskQuery.data}
                value={taskData}
                onChange={handleTaskChange}
              />
            </div>
          )}

          {(taskQuery.data.procedure?.steps?.length ?? 0) > 0 && (
            <div className="mt-4">
              <ProcedureRunner
                task={taskQuery.data}
                taskData={taskData}
                onChange={handleTaskChange}
              />
            </div>
          )}

          <div className="mt-2 text-xs text-slate-500">
            {update.isPending && <span>Saving…</span>}
            {!update.isPending && savedAt && (
              <span>Saved {savedAt.toLocaleTimeString()}</span>
            )}
          </div>
        </section>
      )}

      <LinkedItems entityType="service_request" entityId={data.id} />
      <ActivityTimeline
        entityType="service_request"
        entityId={data.id}
        task={taskQuery.data}
        taskData={taskData}
      />

      {dispatchOpen && (
        <DispatchDialog
          srNumber={data.sr_number}
          defaultPriority={data.priority}
          onClose={() => setDispatchOpen(false)}
          onDispatched={(wo) => {
            setDispatchOpen(false);
            navigate(`/${slug}/work-orders/${wo}`);
          }}
        />
      )}

      {closeOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-slate-900 p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Close service request</h3>
            <label className="block text-sm">
              <span className="text-slate-200">Reason</span>
              <select
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value as SrClosureReason)}
                className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
              >
                {CLOSURE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-200">Notes</span>
              <textarea
                rows={3}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCloseOpen(false)}
                className="rounded border border-slate-700 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => transition("closed")}
                disabled={update.isPending}
                className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400 disabled:opacity-50"
              >
                Close SR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-sm">
      <span className="block text-xs uppercase text-slate-400">{label}</span>
      {value ?? <span className="text-slate-400">—</span>}
    </p>
  );
}
