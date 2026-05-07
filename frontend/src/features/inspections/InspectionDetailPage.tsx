import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Dash } from "../../components/Dash";
import { DetailHeader } from "../../components/DetailHeader";
import { ErrorState, LoadingState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { formatDateTime } from "../../lib/format";
import { ActivityTimeline } from "../activity/ActivityTimeline";
import { LinkedItems } from "../links/LinkedItems";
import { ProcedureRunner } from "../tasks/ProcedureRunner";
import { getTaskDefinition, type TaskDefinitionRead } from "../tasks/api";
import { TaskFormRenderer, type TaskData } from "../tasks/TaskFormRenderer";
import type { InspectionRead } from "./api";
import { useInspection, useUpdateInspection } from "./hooks";

export function InspectionDetailPage() {
  const { slug, n } = useParams<{ slug: string; n: string }>();
  const insQuery = useInspection(n);
  const update = useUpdateInspection(n ?? "");
  const queryClient = useQueryClient();

  const taskCode = insQuery.data?.task_definition_code ?? null;
  const taskQuery = useQuery<TaskDefinitionRead, Error>({
    queryKey: ["task-definition", taskCode],
    queryFn: () => getTaskDefinition(taskCode!),
    enabled: !!taskCode,
  });

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Tracks "user edited but server hasn't acknowledged yet" — covers
  // both the 600 ms debounce window and the in-flight PATCH.
  const [pendingSave, setPendingSave] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  if (insQuery.isLoading) return <LoadingState />;
  if (insQuery.error)
    return <ErrorState message={insQuery.error.message} retry={() => insQuery.refetch()} />;
  const ins = insQuery.data!;
  const taskData = ins.task_data;

  function handleTaskChange(next: TaskData) {
    // Optimistic cache write — instant UI update; debounced PATCH persists.
    queryClient.setQueryData<InspectionRead>(["inspection", n], (prev) =>
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

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <UnsavedChangesGuard
        dirty={pendingSave || update.isPending}
        title="Leave with unsaved inspection edits?"
        message="Your last edit hasn't synced to the server yet. Leave anyway and lose it?"
      />
      <DetailHeader
        backTo={`/${slug}/inspections`}
        backLabel="Back to inspections"
        title={ins.inspection_number}
        subtitle={
          <>
            {ins.kind.replace(/_/g, " ")} · performed {formatDateTime(ins.performed_at)}
            {ins.asset_uid && (
              <>
                {" · "}
                <Link to={`/${slug}/assets/${ins.asset_uid}`} className="font-mono hover:underline">
                  {ins.asset_uid}
                </Link>
              </>
            )}
            {ins.work_order_number && (
              <>
                {" · "}
                <Link
                  to={`/${slug}/work-orders/${ins.work_order_number}`}
                  className="font-mono hover:underline"
                >
                  {ins.work_order_number}
                </Link>
              </>
            )}
          </>
        }
        trailing={
          ins.pass === null ? null : ins.pass ? (
            <StatusPill tone="success" dot>
              Pass
            </StatusPill>
          ) : (
            <StatusPill tone="danger" dot>
              Fail
            </StatusPill>
          )
        }
      />

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">Summary</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-slate-400">Overall condition</dt>
          <dd>{ins.overall_condition ?? <Dash />}</dd>
          <dt className="text-slate-400">Pass</dt>
          <dd>{ins.pass === null ? <Dash /> : ins.pass ? "Pass" : "Fail"}</dd>
        </dl>
        {ins.notes && (
          <p className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">{ins.notes}</p>
        )}
      </section>

      {ins.kind === "cctv" ? (
        <CctvLayout data={ins.data} />
      ) : (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">
            {ins.kind.replace(/_/g, " ")} data
          </h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {Object.entries(ins.data).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-400 font-mono text-xs">{k}</dt>
                <dd className="text-slate-100">{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
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

      <LinkedItems entityType="inspection" entityId={ins.id} />
      <ActivityTimeline
        entityType="inspection"
        entityId={ins.id}
        task={taskQuery.data}
        taskData={taskData}
      />
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface CctvObservation {
  distance_m: string | number;
  code: string;
  remarks?: string;
  clock_from?: number;
  clock_to?: number;
  joint?: boolean;
  continuous?: boolean;
  severity?: number;
}

function CctvLayout({ data }: { data: Record<string, unknown> }) {
  const obs = (data.observations as CctvObservation[] | undefined) ?? [];
  const ratings = data.ratings as
    | {
        structural_qr?: number;
        om_qr?: number;
        structural_total?: number;
        om_total?: number;
      }
    | undefined;
  const sorted = [...obs].sort((a, b) => Number(a.distance_m) - Number(b.distance_m));
  return (
    <>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">Survey</h2>
        <dl className="grid grid-cols-3 gap-y-1 text-sm">
          <dt className="text-slate-400">Standard</dt>
          <dd className="col-span-2">
            {String(data.standard ?? "PACP")} {String(data.version ?? "")}
          </dd>
          <dt className="text-slate-400">Direction</dt>
          <dd className="col-span-2">{String(data.direction ?? "—")}</dd>
          <dt className="text-slate-400">Upstream MH</dt>
          <dd className="col-span-2 font-mono">{String(data.upstream_mh ?? "—")}</dd>
          <dt className="text-slate-400">Downstream MH</dt>
          <dd className="col-span-2 font-mono">{String(data.downstream_mh ?? "—")}</dd>
          <dt className="text-slate-400">Length surveyed</dt>
          <dd className="col-span-2">{String(data.length_surveyed_m ?? "—")} m</dd>
        </dl>
        {ratings && (
          <dl className="grid grid-cols-4 gap-y-1 text-sm mt-3 pt-3 border-t border-slate-100">
            <dt className="text-slate-400">Structural QR</dt>
            <dd>{ratings.structural_qr ?? "—"}</dd>
            <dt className="text-slate-400">O&amp;M QR</dt>
            <dd>{ratings.om_qr ?? "—"}</dd>
          </dl>
        )}
      </section>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400 mb-2">
          Observations ({sorted.length})
        </h2>
        {sorted.length === 0 && <p className="text-sm text-slate-400">None</p>}
        {sorted.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-300 text-left">
              <tr>
                <th className="px-2 py-1">Distance</th>
                <th className="px-2 py-1">Code</th>
                <th className="px-2 py-1">Clock</th>
                <th className="px-2 py-1">Flags</th>
                <th className="px-2 py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((o, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono text-xs">{String(o.distance_m)} m</td>
                  <td className="px-2 py-1 font-mono">{o.code}</td>
                  <td className="px-2 py-1 text-xs text-slate-400">
                    {o.clock_from && o.clock_to ? `${o.clock_from}→${o.clock_to}` : "—"}
                  </td>
                  <td className="px-2 py-1 text-xs text-slate-400">
                    {[o.joint && "J", o.continuous && "C"].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-2 py-1 text-slate-200">{o.remarks ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
