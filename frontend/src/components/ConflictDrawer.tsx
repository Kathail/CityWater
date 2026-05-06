import { useEffect, useState } from "react";
import {
  type QueuedMutation,
  discardMutation,
  drainQueue,
  listMutations,
} from "../lib/offline";

interface Props {
  onClose: () => void;
}

export function ConflictDrawer({ onClose }: Props) {
  const [items, setItems] = useState<QueuedMutation[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function refresh() {
    const all = await listMutations();
    setItems(
      all.filter(
        (m) => m.status === "conflict" || m.status === "failed" || m.status === "queued",
      ),
    );
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function discard(id: number) {
    setBusyId(id);
    try {
      await discardMutation(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function retry(_id: number) {
    setBusyId(_id);
    try {
      // The queue's drainQueue() only retries entries with status='queued'.
      // For now, retry from the conflict drawer kicks a full drain — pending
      // entries with status='queued' will go, and conflict entries surface
      // their state for the user to discard or wait for a new SW build.
      await drainQueue();
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-slate-900/30" onClick={onClose} />
      <aside className="w-full max-w-md overflow-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">Offline queue</h2>
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:underline"
          >
            Close
          </button>
        </header>
        <ul className="divide-y divide-slate-100">
          {items.length === 0 && (
            <li className="p-6 text-center text-sm text-slate-500">
              Nothing pending. You're caught up.
            </li>
          )}
          {items.map((m) => (
            <li key={m.id} className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">
                  {m.method} {m.url}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    m.status === "conflict"
                      ? "bg-red-100 text-red-800"
                      : m.status === "failed"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {m.status}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Enqueued {new Date(m.enqueuedAt).toLocaleString()} · attempts: {m.attempts}
              </p>
              {m.errorStatus && (
                <p className="text-xs text-red-700">
                  Server returned {m.errorStatus}
                  {m.errorMessage ? `: ${m.errorMessage}` : ""}
                </p>
              )}
              <div className="flex gap-2">
                {m.id !== undefined && (
                  <>
                    <button
                      onClick={() => retry(m.id!)}
                      disabled={busyId === m.id}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => discard(m.id!)}
                      disabled={busyId === m.id}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
