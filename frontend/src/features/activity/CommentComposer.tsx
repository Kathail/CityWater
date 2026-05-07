import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { useAssets } from "../assets/hooks";
import { ChecklistDraft } from "../tasks/ChecklistDraft";
import { SmartCommentChips } from "../tasks/SmartCommentChips";
import type { TaskDefinitionRead } from "../tasks/api";
import { type ActivityEntityType } from "./api";
import { useCreateComment } from "./hooks";

/**
 * Tablet-first comment composer.
 *
 * Free-text body + an asset-reference picker. Tapping an asset inserts
 * its UID into the body at the cursor (or appends), so a comment like
 * "Flushed H8-010" is two taps + a couple of words. Operator name and
 * timestamp are stamped server-side and rendered by the timeline.
 *
 * For structured "what was done" recording on a work order, the task
 * feature is the primary tool — task completions also show up here as
 * audit events. Comments are the catch-all for everything else.
 */

interface Props {
  entityType: ActivityEntityType;
  entityId: number;
  /** When the parent entity is task-driven, both the smart-comment chips
   * (always-on suggestions) and the checklist draft (rolled-up text from
   * ticked procedure steps) render in the composer. The chips and the
   * checklist are complementary — chips for narrative SR-style comments,
   * checklist for repetitive daily-WO summaries. */
  task?: TaskDefinitionRead;
  taskData?: Record<string, unknown>;
  /** Per-stop entries the operator recently completed in this view
   * session (e.g. ticked-off route-WO stops). Each carries the
   * asset_uid and an optional pre-rendered narrative `comment` (from
   * the task definition's smart_comments + that stop's task_data).
   * When the operator clicks "Use as comment" the rendered narratives
   * are joined and dropped into the body — no typing. When `comment`
   * is null, the bare UID is used. Cleared via
   * onClearPendingAssetRefs once the comment is posted. */
  pendingAssetRefs?: { asset_uid: string; comment: string | null }[];
  onClearPendingAssetRefs?: () => void;
}

export function CommentComposer({
  entityType,
  entityId,
  task,
  taskData,
  pendingAssetRefs,
  onClearPendingAssetRefs,
}: Props) {
  const [body, setBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const create = useCreateComment(entityType, entityId);

  // Load matching assets only when the picker is open and there's a hint.
  const assets = useAssets({ q: assetQuery, page_size: 20 }, pickerOpen && assetQuery.length >= 1);

  function insertReference(uid: string) {
    insertAtCursor(uid);
    setPickerOpen(false);
    setAssetQuery("");
  }

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setBody((b) => (b ? `${b.trimEnd()} ${text}` : text));
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const padBefore = before.length === 0 || /\s$/.test(before) ? "" : " ";
    const padAfter = after.length === 0 || /^\s/.test(after) ? "" : " ";
    const next = `${before}${padBefore}${text}${padAfter}${after}`;
    setBody(next);
    queueMicrotask(() => {
      ta.focus();
      const cursor = before.length + padBefore.length + text.length;
      ta.setSelectionRange(cursor, cursor);
    });
  }

  function applySuggestion(text: string) {
    // Empty body → replace; non-empty → insert at cursor with spacing.
    if (!body.trim()) setBody(text);
    else insertAtCursor(text);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setErrorMessage(null);
    try {
      await create.mutateAsync({
        entity_type: entityType,
        entity_id: entityId,
        body: body.trim(),
      });
      setBody("");
      // Comment posted → the "completed-this-session" chip set has been
      // recorded (either in body or via insertAll). Clear so we don't
      // keep showing stale chips.
      onClearPendingAssetRefs?.();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : String(err));
    }
  }

  function insertAllPending() {
    if (!pendingAssetRefs?.length) return;
    // Prefer the rendered narrative (one bullet per stop) when the WO
    // has a task definition. Falls back to a "Completed: UID, UID, ..."
    // line for stops with no rendered comment.
    const lines: string[] = [];
    const bareUids: string[] = [];
    for (const ref of pendingAssetRefs) {
      if (ref.comment) lines.push(`- ${ref.asset_uid}: ${ref.comment}`);
      else bareUids.push(ref.asset_uid);
    }
    if (bareUids.length) lines.push(`Completed: ${bareUids.join(", ")}`);
    const draft = lines.join("\n");
    if (!body.trim()) setBody(draft);
    else insertAtCursor(draft);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {pendingAssetRefs && pendingAssetRefs.length > 0 && (
        <div
          className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3"
          aria-label="Recently completed assets"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-300">
              Completed ({pendingAssetRefs.length} stop
              {pendingAssetRefs.length === 1 ? "" : "s"})
            </p>
            <button
              type="button"
              onClick={insertAllPending}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100 hover:border-emerald-400 hover:bg-emerald-500/20"
            >
              Use as comment
            </button>
          </div>
          <ul className="space-y-1 text-sm text-slate-200">
            {pendingAssetRefs.map((ref) => (
              <li key={ref.asset_uid} className="flex flex-wrap items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => insertReference(ref.asset_uid)}
                  className="font-mono text-xs text-emerald-100 underline-offset-2 hover:underline"
                  title="Insert just this UID"
                >
                  {ref.asset_uid}
                </button>
                {ref.comment ? (
                  <span className="text-slate-300">— {ref.comment}</span>
                ) : (
                  <span className="text-xs text-slate-500">(no observations recorded)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add a comment…"
        className="block w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
      />

      {task && <ChecklistDraft task={task} taskData={taskData ?? {}} onPick={applySuggestion} />}

      {task?.smart_comments && task.smart_comments.length > 0 && (
        <SmartCommentChips
          smartComments={task.smart_comments}
          taskData={taskData ?? {}}
          onPick={applySuggestion}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="min-h-11 rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-blue-500/50 hover:bg-slate-800"
        >
          {pickerOpen ? "Close" : "+ Reference an asset"}
        </button>
        {body && (
          <button
            type="button"
            onClick={() => setBody("")}
            className="text-xs text-slate-400 hover:text-red-300 hover:underline"
          >
            Clear
          </button>
        )}
        <button
          type="submit"
          disabled={create.isPending || !body.trim()}
          className="btn-primary min-h-11 px-5 py-2 text-sm"
        >
          {create.isPending ? "Posting…" : "Post comment"}
        </button>
      </div>

      {pickerOpen && (
        <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 space-y-2">
          <input
            value={assetQuery}
            onChange={(e) => setAssetQuery(e.target.value)}
            placeholder="Type asset UID, material, manufacturer…"
            className="block w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            {assets.data?.items.slice(0, 20).map((a) => (
              <button
                key={a.asset_uid}
                type="button"
                onClick={() => insertReference(a.asset_uid)}
                className="min-h-11 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:border-blue-500/50 hover:bg-slate-800"
              >
                <span className="font-mono">{a.asset_uid}</span>
                <span className="ml-2 text-xs text-slate-400">{a.class_code}</span>
              </button>
            ))}
            {assets.data && assets.data.items.length === 0 && assetQuery && (
              <p className="text-xs text-slate-500">No matching assets.</p>
            )}
            {!assetQuery && <p className="text-xs text-slate-500">Start typing to search.</p>}
          </div>
        </div>
      )}

      {errorMessage && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
