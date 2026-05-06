import { useEffect, useState } from "react";
import {
  type QueueListener,
  drainQueue,
  queueCounts,
  subscribeQueue,
} from "../lib/offline/queue";

interface Props {
  onOpenConflicts: () => void;
}

export function OfflineBanner({ onOpenConflicts }: Props) {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [counts, setCounts] = useState({ queued: 0, conflict: 0, failed: 0 });
  const [draining, setDraining] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    void queueCounts().then(setCounts);
    const listener: QueueListener = (c) => setCounts(c);
    const unsub = subscribeQueue(listener);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      unsub();
    };
  }, []);

  const total = counts.queued + counts.conflict + counts.failed;
  if (online && total === 0) return null;

  async function syncNow() {
    setDraining(true);
    try {
      await drainQueue();
      setCounts(await queueCounts());
    } finally {
      setDraining(false);
    }
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${
        online
          ? "bg-amber-100 text-amber-900"
          : "bg-slate-900 text-slate-100"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            online ? "bg-amber-500" : "bg-red-500"
          }`}
        />
        <span>
          {online ? "Online" : "Offline"}
          {counts.queued > 0 && ` · ${counts.queued} queued`}
          {counts.conflict > 0 && ` · ${counts.conflict} conflict${counts.conflict === 1 ? "" : "s"}`}
          {counts.failed > 0 && ` · ${counts.failed} failed`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {counts.conflict + counts.failed > 0 && (
          <button
            onClick={onOpenConflicts}
            className="rounded border border-current px-2 py-0.5 text-xs hover:bg-current/10"
          >
            Review
          </button>
        )}
        {online && counts.queued > 0 && (
          <button
            onClick={syncNow}
            disabled={draining}
            className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {draining ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>
    </div>
  );
}
