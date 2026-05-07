import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { DetailHeader } from "../../components/DetailHeader";
import { ErrorState, LoadingState } from "../../components/States";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { formatDateTime } from "../../lib/format";
import { translateApiError } from "../../lib/translateApiError";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { LinkedItems } from "../links/LinkedItems";
import { AreaChips } from "../tasks/AreaChips";
import { ProcedureRunner } from "../tasks/ProcedureRunner";
import { getTaskDefinition, type TaskDefinitionRead } from "../tasks/api";
import { TaskFormRenderer, type TaskData } from "../tasks/TaskFormRenderer";
import { DispatchDialog } from "./DispatchDialog";
import type { ServiceRequestRead, SrClosureReason } from "./api";
import { SR_DETAIL_KEY, useServiceRequest, useUpdateServiceRequest } from "./hooks";

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

  const queryClient = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Tracks "user edited but server hasn't acknowledged yet" — covers both
  // the 600 ms debounce window and the in-flight PATCH.
  const [pendingSave, setPendingSave] = useState(false);

  // Clear any pending debounce on unmount so a fast navigation doesn't
  // setState on a freed component (WO-P1-7).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message="Failed to load." retry={() => query.refetch()} />;
  if (!query.data) return null;

  const data = query.data;
  const taskData = data.task_data;

  function handleTaskChange(next: TaskData) {
    // Optimistic cache write — instant UI update for the form, the
    // procedure checkboxes, the smart-comment chips, and the checklist
    // draft. Cache is the single source of truth for task_data.
    queryClient.setQueryData<ServiceRequestRead>([SR_DETAIL_KEY, sr], (prev) =>
      prev ? { ...prev, task_data: next } : prev,
    );
    setPendingSave(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      update.mutate(
        { task_data: next },
        {
          onSuccess: () => {
            setSavedAt(new Date());
            setPendingSave(false);
          },
          onError: () => setPendingSave(false),
        },
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
      setErrorMessage(translateApiError(err));
    }
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <UnsavedChangesGuard
        dirty={pendingSave || update.isPending}
        title="Leave with unsaved service-request edits?"
        message="Your last edit hasn't synced to the server yet. Leave anyway and lose it?"
      />
      <DetailHeader
        backTo={`/${slug}/service-requests`}
        backLabel="Back to service requests"
        title={data.sr_number}
        subtitle={
          <>
            {data.category} · {data.domain} · <span className="font-medium">{data.status}</span> ·
            priority {data.priority}
          </>
        }
        meta={
          <AreaChips areas={data.areas} domain={taskQuery.data?.default_domain ?? data.domain} />
        }
        trailing={
          <div className="flex flex-wrap items-center gap-2">
            {data.status === "new" && (
              <Button
                variant="ghost"
                onClick={() => transition("triaged")}
                disabled={update.isPending}
              >
                Mark triaged
              </Button>
            )}
            {!["closed", "duplicate", "dispatched"].includes(data.status) && (
              <Button onClick={() => setDispatchOpen(true)}>Dispatch as work order</Button>
            )}
            {!["closed", "duplicate"].includes(data.status) && (
              <Button variant="ghost" onClick={() => setCloseOpen(true)}>
                Close
              </Button>
            )}
          </div>
        }
      />

      {errorMessage && <Alert>{errorMessage}</Alert>}

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Caller</h2>
          <Field label="Name" value={data.caller_name} />
          <Field label="Phone" value={data.caller_phone} />
          <Field label="Email" value={data.caller_email} />
          <Field label="Reported" value={formatDateTime(data.reported_at)} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Location</h2>
          <Field label="Address" value={data.reported_address} />
          {data.location && (
            <p className="text-sm text-slate-200">
              {data.location.coordinates[0].toFixed(5)}, {data.location.coordinates[1].toFixed(5)}
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
                {formatDateTime(data.closed_at)}
              </span>
            )}
          </p>
          {data.closure_notes && (
            <p className="whitespace-pre-line text-sm text-slate-200">{data.closure_notes}</p>
          )}
        </section>
      )}

      {taskQuery.data && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">Task</h2>
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
            {!update.isPending && savedAt && <span>Saved {savedAt.toLocaleTimeString()}</span>}
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
              <Button variant="ghost" onClick={() => setCloseOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => transition("closed")} disabled={update.isPending}>
                Close SR
              </Button>
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
