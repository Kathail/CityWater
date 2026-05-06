import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
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

  if (query.isLoading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (query.isError) return <div className="p-8 text-red-600">Failed to load.</div>;
  if (!query.data) return null;

  const data = query.data;

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
          <h1 className="text-2xl font-semibold text-slate-900">
            {data.sr_number}
          </h1>
          <p className="text-sm text-slate-500">
            {data.category} · {data.domain} ·{" "}
            <span className="font-medium">{data.status}</span> · priority {data.priority}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === "new" && (
            <button
              onClick={() => transition("triaged")}
              disabled={update.isPending}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Mark triaged
            </button>
          )}
          {!["closed", "duplicate", "dispatched"].includes(data.status) && (
            <button
              onClick={() => setDispatchOpen(true)}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              Dispatch as work order
            </button>
          )}
          {!["closed", "duplicate"].includes(data.status) && (
            <button
              onClick={() => setCloseOpen(true)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Close
            </button>
          )}
        </div>
      </header>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Caller</h2>
          <Field label="Name" value={data.caller_name} />
          <Field label="Phone" value={data.caller_phone} />
          <Field label="Email" value={data.caller_email} />
          <Field label="Reported" value={new Date(data.reported_at).toLocaleString()} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Location</h2>
          <Field label="Address" value={data.address} />
          {data.location && (
            <p className="text-sm text-slate-700">
              {data.location.coordinates[0].toFixed(5)},{" "}
              {data.location.coordinates[1].toFixed(5)}
            </p>
          )}
          {data.work_order_number && (
            <p className="text-sm">
              <span className="text-slate-500">Linked WO: </span>
              <Link
                to={`/${slug}/work-orders/${data.work_order_number}`}
                className="text-slate-900 hover:underline"
              >
                {data.work_order_number}
              </Link>
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Description</h2>
        <p className="whitespace-pre-line text-sm text-slate-800">
          {data.description ?? <span className="text-slate-400">none</span>}
        </p>
      </section>

      {data.closure_reason && (
        <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Closure</h2>
          <p className="text-sm text-slate-800">
            <span className="font-medium">{data.closure_reason}</span>
            {data.closed_at && (
              <span className="text-slate-500">
                {" — "}
                {new Date(data.closed_at).toLocaleString()}
              </span>
            )}
          </p>
          {data.closure_notes && (
            <p className="whitespace-pre-line text-sm text-slate-700">
              {data.closure_notes}
            </p>
          )}
        </section>
      )}

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
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Close service request</h3>
            <label className="block text-sm">
              <span className="text-slate-700">Reason</span>
              <select
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value as SrClosureReason)}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {CLOSURE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Notes</span>
              <textarea
                rows={3}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCloseOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => transition("closed")}
                disabled={update.isPending}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
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
      <span className="block text-xs uppercase text-slate-500">{label}</span>
      {value ?? <span className="text-slate-400">—</span>}
    </p>
  );
}
