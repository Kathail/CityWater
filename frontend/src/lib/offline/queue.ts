import { type QueuedMutation, getDB } from "./db";

const MAX_QUEUE = 200;

export type QueueListener = (counts: {
  queued: number;
  conflict: number;
  failed: number;
}) => void;

const listeners = new Set<QueueListener>();

export function subscribeQueue(fn: QueueListener): () => void {
  listeners.add(fn);
  notify();
  return () => {
    listeners.delete(fn);
  };
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const counts = await queueCounts();
  for (const fn of listeners) fn(counts);
}

export async function queueCounts(): Promise<{
  queued: number;
  conflict: number;
  failed: number;
}> {
  const db = await getDB();
  const idx = db.transaction("mutations").store.index("byStatus");
  const [queued, conflict, failed] = await Promise.all([
    idx.count("queued"),
    idx.count("conflict"),
    idx.count("failed"),
  ]);
  return { queued, conflict, failed };
}

export async function enqueueMutation(
  m: Omit<QueuedMutation, "id" | "enqueuedAt" | "attempts" | "status">,
): Promise<QueuedMutation> {
  const db = await getDB();

  // Bound the queue. Drop the oldest non-conflict entries past MAX_QUEUE so
  // a long offline session doesn't fill IDB.
  const total = await db.count("mutations");
  if (total >= MAX_QUEUE) {
    const tx = db.transaction("mutations", "readwrite");
    const all = await tx.store.index("byStatus").getAll("queued");
    const toDelete = all.slice(0, all.length - (MAX_QUEUE - 1));
    for (const entry of toDelete) {
      if (entry.id !== undefined) await tx.store.delete(entry.id);
    }
    await tx.done;
  }

  const record: QueuedMutation = {
    ...m,
    enqueuedAt: Date.now(),
    attempts: 0,
    status: "queued",
  };
  const id = await db.add("mutations", record);
  await notify();
  return { ...record, id: id as number };
}

export async function listMutations(): Promise<QueuedMutation[]> {
  const db = await getDB();
  return db.getAll("mutations");
}

export async function discardMutation(id: number): Promise<void> {
  const db = await getDB();
  await db.delete("mutations", id);
  await notify();
}

export async function clearMutations(): Promise<void> {
  const db = await getDB();
  await db.clear("mutations");
  await notify();
}

/**
 * Replay every queued mutation against the network. Conflicts (4xx) are
 * marked `conflict` so the user can review them; transient failures (5xx,
 * network errors) keep the entry in `queued` for the next drain.
 */
export async function drainQueue(): Promise<{
  replayed: number;
  conflict: number;
  remaining: number;
}> {
  const db = await getDB();
  const queued = await db.getAllFromIndex("mutations", "byStatus", "queued");
  let replayed = 0;
  let conflict = 0;

  for (const m of queued) {
    if (m.id === undefined) continue;
    await markStatus(m.id, "in_flight");
    try {
      const headers: Record<string, string> = {};
      if (m.contentType) headers["Content-Type"] = m.contentType;
      // Best-effort CSRF — we read the cookie afresh in case the user has
      // logged in/out between enqueue and drain.
      const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
      if (csrf) headers["X-CSRFToken"] = decodeURIComponent(csrf[1]);
      const resp = await fetch(m.url, {
        method: m.method,
        headers,
        body: m.body ?? undefined,
        credentials: "include",
      });
      if (resp.ok) {
        await db.delete("mutations", m.id);
        replayed += 1;
      } else if (resp.status >= 400 && resp.status < 500) {
        // 4xx — server rejected; surface to user. 401/403 also count as
        // conflict so the field user sees the failure rather than silently
        // retrying forever.
        const text = await resp.text();
        await updateRecord(m.id, {
          status: "conflict",
          errorStatus: resp.status,
          errorMessage: text.slice(0, 500),
          attempts: m.attempts + 1,
        });
        conflict += 1;
      } else {
        // 5xx or transport error caught below — leave queued for next drain.
        await updateRecord(m.id, {
          status: "queued",
          errorStatus: resp.status,
          attempts: m.attempts + 1,
        });
      }
    } catch (err) {
      await updateRecord(m.id, {
        status: "queued",
        errorMessage: err instanceof Error ? err.message : String(err),
        attempts: m.attempts + 1,
      });
    }
  }

  const remaining = await db.count("mutations");
  await notify();
  return { replayed, conflict, remaining };
}

async function markStatus(
  id: number,
  status: QueuedMutation["status"],
): Promise<void> {
  await updateRecord(id, { status });
}

async function updateRecord(
  id: number,
  patch: Partial<QueuedMutation>,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("mutations", "readwrite");
  const current = await tx.store.get(id);
  if (current) {
    await tx.store.put({ ...current, ...patch });
  }
  await tx.done;
}
