import { useMemo, useState } from "react";
import { ApiError } from "../../lib/apiClient";
import { useAuth } from "../auth/useAuth";
import type { TaskDefinitionRead } from "../tasks/api";
import { type ActivityEntityType, type CommentRead, type HistoryEvent } from "./api";
import { CommentComposer } from "./CommentComposer";
import {
  useComments,
  useDeleteComment,
  useHistory,
  useUpdateComment,
} from "./hooks";

interface Props {
  entityType: ActivityEntityType;
  entityId: number;
  /** When the parent entity is task-driven, pass the active task and the
   * operator's current task_data — both the smart-comment chips and the
   * checklist draft will render in the comment composer. */
  task?: TaskDefinitionRead;
  taskData?: Record<string, unknown>;
}

type TimelineRow =
  | { kind: "comment"; at: string; data: CommentRead }
  | { kind: "event"; at: string; data: HistoryEvent };

export function ActivityTimeline({
  entityType,
  entityId,
  task,
  taskData,
}: Props) {
  const comments = useComments(entityType, entityId);
  const history = useHistory(entityType, entityId);

  const rows: TimelineRow[] = useMemo(() => {
    const out: TimelineRow[] = [];
    for (const c of comments.data?.items ?? []) {
      out.push({ kind: "comment", at: c.created_at, data: c });
    }
    for (const e of history.data?.items ?? []) {
      // Don't double-count comment_create events — the comment itself is
      // already in the feed and richer.
      if (e.entity_type === "Comment") continue;
      out.push({ kind: "event", at: e.occurred_at, data: e });
    }
    out.sort((a, b) => (b.at > a.at ? 1 : -1));
    return out;
  }, [comments.data, history.data]);

  return (
    <section className="surface p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Activity
      </h2>

      <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-4">
        <CommentComposer
          entityType={entityType}
          entityId={entityId}
          task={task}
          taskData={taskData}
        />
      </div>

      {(comments.isLoading || history.isLoading) && (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      )}

      <ol className="mt-4 space-y-3">
        {rows.length === 0 && !comments.isLoading && !history.isLoading && (
          <li className="text-sm text-slate-500">
            No activity yet. Be the first to comment.
          </li>
        )}
        {rows.map((row) =>
          row.kind === "comment" ? (
            <CommentRow
              key={`c-${row.data.id}`}
              comment={row.data}
              entityType={entityType}
              entityId={entityId}
            />
          ) : (
            <EventRow key={`e-${row.data.id}`} event={row.data} />
          ),
        )}
      </ol>
    </section>
  );
}

function CommentRow({
  comment,
  entityType,
  entityId,
}: {
  comment: CommentRead;
  entityType: ActivityEntityType;
  entityId: number;
}) {
  const { user } = useAuth();
  const isAuthor = user && comment.created_by === user.id;
  const isAdmin = !!user?.roles.some((r) =>
    ["admin", "supervisor"].includes(r.code),
  );
  const canEdit = isAuthor || isAdmin;

  const update = useUpdateComment(entityType, entityId);
  const remove = useDeleteComment(entityType, entityId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function save() {
    setErrorMessage(null);
    try {
      await update.mutateAsync({ commentId: comment.id, body: draft.trim() });
      setEditing(false);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs text-slate-400">
          <span className="text-slate-200 font-medium">
            {comment.author_name ?? "Unknown"}
          </span>
          <span className="ml-2">{relativeTime(comment.created_at)}</span>
          {comment.edited_at && (
            <span className="ml-2 italic text-slate-500">(edited)</span>
          )}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setEditing(true)}
              className="text-slate-400 hover:text-blue-300"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm("Delete this comment?")) {
                  remove.mutate(comment.id);
                }
              }}
              className="text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="block w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
          />
          {errorMessage && (
            <p className="text-xs text-red-400">{errorMessage}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={update.isPending}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
          {comment.body}
        </p>
      )}
    </li>
  );
}

function EventRow({ event }: { event: HistoryEvent }) {
  return (
    <li className="flex items-start gap-3 rounded border border-transparent px-3 py-2 hover:border-slate-800 hover:bg-slate-900/40">
      <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
      <div className="flex-1 min-w-0 text-sm">
        <p className="text-slate-300">
          {formatEvent(event)}
          {event.actor && (
            <span className="text-slate-500"> — {event.actor}</span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {relativeTime(event.occurred_at)}
        </p>
      </div>
    </li>
  );
}

// Lightweight relative-time formatter — avoids pulling date-fns just for this.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ACTION_LABELS: Record<string, string> = {
  // Auth
  login: "Signed in",
  logout: "Signed out",
  login_failed: "Failed sign-in attempt",
  // WO
  wo_transition: "Status changed",
  // SR
  sr_transition: "Status changed",
  sr_dispatch: "Dispatched as work order",
  // Inspection
  // Schedule
  schedule_create: "Created the schedule",
  schedule_delete: "Deleted the schedule",
  schedule_tick: "Schedule tick fired",
  // Links
  link_create: "Linked a related item",
  link_delete: "Removed a link",
  // Invitations
  invitation_create: "Sent an invitation",
  invitation_accept: "Accepted an invitation",
  invitation_revoke: "Revoked an invitation",
  // Audit retention
  audit_retention_cleanup: "Audit log cleanup ran",
  // Asset class
  asset_class_update: "Updated an asset class",
  // CRUD shorthand from the audit listener
  create: "Created",
  update: "Updated",
  delete: "Deleted",
};

function formatEvent(e: HistoryEvent): string {
  const base = ACTION_LABELS[e.action] ?? e.action;
  if (e.action === "wo_transition" || e.action === "sr_transition") {
    const before = (e.before ?? {}) as { status?: string };
    const after = (e.after ?? {}) as { status?: string };
    if (before.status && after.status) {
      return `${base}: ${before.status} → ${after.status}`;
    }
  }
  if (e.action === "link_create" || e.action === "link_delete") {
    const after = (e.after ?? e.before ?? {}) as {
      source?: string;
      target?: string;
      kind?: string;
    };
    if (after.source && after.target) {
      return `${base}: ${after.source} ↔ ${after.target}`;
    }
  }
  return base;
}
