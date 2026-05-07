import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { interpolate, safeEvaluate } from "../../lib/expr";
import { translateApiError } from "../../lib/translateApiError";
import { useAssets } from "../assets/hooks";
import { TaskFormRenderer } from "../tasks/TaskFormRenderer";
import type { TaskDefinitionRead } from "../tasks/api";
import {
  addWoAssets,
  removeWoAsset,
  updateWoAsset,
  type WoAsset,
  type WorkOrderDetail,
} from "./api";

/** Most common asset class on this WO so the AssetPicker can default
 * its class filter to it — second/third stop adds don't make the
 * operator re-pick the same class every time. Returns undefined for
 * an empty WO so the picker stays "Any class". */
function mostCommonClassOf(assets: { class_code: string }[]): string | undefined {
  if (!assets.length) return undefined;
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.class_code, (counts.get(a.class_code) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [code, n] of counts) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}

/** Render the first matching smart_comment for `taskData` against the
 * task definition. Returns null when nothing applies. Mirrors the
 * SmartCommentChips pick logic so the operator gets the same narrative
 * the chip strip would produce — without typing anything. */
function renderSmartComment(
  task: TaskDefinitionRead | undefined,
  taskData: Record<string, unknown>,
): string | null {
  if (!task?.smart_comments?.length) return null;
  for (const c of task.smart_comments) {
    if (!c?.id || !c?.text) continue;
    if (c.condition && !safeEvaluate(c.condition, taskData, false)) continue;
    return interpolate(c.text, taskData);
  }
  return null;
}

/**
 * Route view for a work order's assets.
 *
 * Daily WOs (hydrant flushing, valve exercising, manhole inspection)
 * carry many assets — sometimes 20+ per day. This panel renders them as
 * an ordered checklist with per-stop completion + a multi-select picker
 * for adding more.
 *
 * Optimistic cache writes keep the UI snappy; the underlying mutations
 * patch through the React Query cache on success.
 */

export function RouteSection({
  wo,
  slug,
  task,
  onAssetCompleted,
}: {
  wo: WorkOrderDetail;
  slug: string | undefined;
  /** Active task definition for the WO. When present, each stop renders
   * the task's `form` fields and the rendered smart_comment is passed
   * to the parent via onAssetCompleted so the comment composer can
   * surface ready-to-post text. */
  task?: TaskDefinitionRead;
  /** Called when the operator ticks an asset complete. The second arg
   * is the rendered smart-comment text (if the task definition + this
   * stop's task_data produced one) — null otherwise so the parent can
   * fall back to the bare UID chip. */
  onAssetCompleted?: (asset_uid: string, comment: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Completed stops disappear from the visible list by default — the
  // operator's mental model is "what's left to do." A toggle expands
  // them inline when needed (audit, mistake recovery).
  const [showCompleted, setShowCompleted] = useState(false);

  const completed = wo.assets.filter((a) => a.completed_at).length;
  const total = wo.assets.length;
  const visibleAssets = showCompleted ? wo.assets : wo.assets.filter((a) => !a.completed_at);

  const update = useMutation({
    mutationFn: (vars: { uid: string; patch: Parameters<typeof updateWoAsset>[2] }) =>
      updateWoAsset(wo.wo_number, vars.uid, vars.patch),
    onSuccess: (next) => queryClient.setQueryData(["work-order", wo.wo_number], next),
  });
  const remove = useMutation({
    mutationFn: (uid: string) => removeWoAsset(wo.wo_number, uid),
    onSuccess: (next) => {
      queryClient.setQueryData(["work-order", wo.wo_number], next);
      setRemoveTarget(null);
    },
    onError: (err) => setRemoveError(translateApiError(err)),
  });
  const add = useMutation({
    mutationFn: (uids: string[]) => addWoAssets(wo.wo_number, uids),
    onSuccess: (next) => {
      queryClient.setQueryData(["work-order", wo.wo_number], next);
      setPickerOpen(false);
    },
  });

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Assets ({completed}/{total})
        </h2>
        <div className="flex items-center gap-2">
          {/* Always-rendered so the affordance is discoverable on the
              first ticked stop. Disabled when no stops are completed
              yet — clicking would do nothing, so don't pretend it's
              live. */}
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            disabled={completed === 0}
            className="text-xs text-slate-400 hover:text-blue-300 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600"
          >
            {showCompleted ? "Hide completed" : `Show ${completed} completed`}
          </button>
          <Button onClick={() => setPickerOpen(true)}>+ Add assets</Button>
        </div>
      </div>

      {wo.assets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No assets attached. Tap <em>Add assets</em> to build the route.
        </p>
      ) : visibleAssets.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-400">All {total} stops complete. ✓</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {visibleAssets.map((a) => (
            <RouteRow
              key={a.asset_uid}
              asset={a}
              slug={slug}
              task={task}
              onToggle={(complete) => {
                update.mutate({ uid: a.asset_uid, patch: { mark_complete: complete } });
                if (complete) {
                  onAssetCompleted?.(a.asset_uid, renderSmartComment(task, a.task_data ?? {}));
                }
              }}
              onSaveTaskData={(taskData) =>
                update.mutate({
                  uid: a.asset_uid,
                  patch: { task_data: taskData },
                })
              }
              onRemove={() => {
                setRemoveError(null);
                setRemoveTarget(a.asset_uid);
              }}
            />
          ))}
        </ol>
      )}

      {pickerOpen && (
        <AssetPicker
          existingUids={new Set(wo.assets.map((a) => a.asset_uid))}
          defaultClass={mostCommonClassOf(wo.assets)}
          onClose={() => setPickerOpen(false)}
          onAdd={(uids) => add.mutate(uids)}
          isPending={add.isPending}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`Remove ${removeTarget} from this WO?`}
          message="The asset stays in your inventory; only its association with this work order is removed."
          confirmLabel="Remove"
          errorMessage={removeError}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removeTarget)}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </section>
  );
}

function RouteRow({
  asset,
  slug,
  task,
  onToggle,
  onSaveTaskData,
  onRemove,
}: {
  asset: WoAsset;
  slug: string | undefined;
  task?: TaskDefinitionRead;
  onToggle: (complete: boolean) => void;
  onSaveTaskData: (taskData: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(asset.task_data ?? {});
  const checked = !!asset.completed_at;
  const renderedComment = useMemo(
    () => renderSmartComment(task, asset.task_data ?? {}),
    [task, asset.task_data],
  );
  const hasFormFields = !!task?.form?.length;

  return (
    <li
      className={`rounded-md border p-3 ${
        checked ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 bg-slate-950/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(!checked)}
          aria-label={checked ? "Mark not done" : "Mark done"}
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${
            checked ? "bg-emerald-500 text-white" : "border border-slate-600 hover:border-slate-400"
          }`}
        >
          {checked ? "✓" : ""}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm">
              <span className="text-slate-500 mr-2">{asset.sequence ?? "—"}.</span>
              <Link
                to={`/${slug}/assets/${asset.asset_uid}`}
                className="font-mono text-slate-100 hover:text-blue-300 hover:underline"
              >
                {asset.asset_uid}
              </Link>
              <span className="ml-2 text-xs text-slate-400">{asset.class_code}</span>
              {asset.role !== "affected" && (
                <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                  {asset.role}
                </span>
              )}
            </p>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setNotesOpen((v) => !v)}
                className="text-slate-400 hover:text-blue-300"
              >
                {notesOpen
                  ? "Hide"
                  : Object.keys(asset.task_data ?? {}).length > 0
                    ? "Observations ✎"
                    : hasFormFields
                      ? "+ Observations"
                      : "+ Note"}
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="text-slate-500 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          </div>
          {asset.address_cached && (
            <p className="mt-0.5 text-xs text-slate-500">{asset.address_cached}</p>
          )}
          {/* Rendered narrative for this stop — what the operator's
              observations would look like as a comment. Auto-collapses
              when the form is open. */}
          {!notesOpen && renderedComment && (
            <p className="mt-1 text-xs italic text-emerald-300">— {renderedComment}</p>
          )}
          {notesOpen && hasFormFields && task && (
            <ObservationsPanel
              task={task}
              draft={draft}
              setDraft={setDraft}
              initial={asset.task_data ?? {}}
              onSave={onSaveTaskData}
              onClose={() => setNotesOpen(false)}
            />
          )}
          {/* Fallback: WOs without a task definition fall back to a
              single free-text note. Same UX the page had before per-
              asset task_data was added. */}
          {notesOpen && !hasFormFields && (
            <FreeTextNote
              initial={asset.completion_notes ?? ""}
              onSave={(notes) => {
                // Store free-text notes under task_data.notes so the
                // chip strip sees something it can render. The WO
                // task_data shape is per-task so this key is fine here.
                onSaveTaskData({ ...(asset.task_data ?? {}), notes });
                setNotesOpen(false);
              }}
              onCancel={() => setNotesOpen(false)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** Per-stop observation panel with debounced autosave. The operator
 * fills the form, doesn't have to click Save — values flush 800ms
 * after the last edit. A small "Saving…/Saved" indicator confirms the
 * commit so the field crew knows their work isn't going to evaporate
 * if they navigate away. "Done" just collapses the panel. */
function ObservationsPanel({
  task,
  draft,
  setDraft,
  initial,
  onSave,
  onClose,
}: {
  task: TaskDefinitionRead;
  draft: Record<string, unknown>;
  setDraft: (next: Record<string, unknown>) => void;
  initial: Record<string, unknown>;
  onSave: (taskData: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "saved">("idle");
  // Skip the initial mount — `draft === initial` so there's nothing to
  // autosave. Without this guard we'd fire one POST per asset on first
  // expand of the panel.
  const isFirst = useRef(true);
  const timer = useRef<number | null>(null);
  // Stable JSON snapshot for shallow equality check across renders. We
  // serialize anyway when sending to the API, so the cost is identical.
  const draftKey = JSON.stringify(draft);
  const initialKey = JSON.stringify(initial);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    if (draftKey === initialKey) return;
    setStatus("pending");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onSave(draft);
      setStatus("saved");
      // Fade the "Saved" pill back to idle after a beat so it doesn't
      // stick around forever — feedback, not chrome.
      window.setTimeout(() => setStatus("idle"), 1500);
    }, 800);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // initialKey is intentionally excluded — when the parent's mutation
    // resolves and asset.task_data updates, we don't want to re-fire
    // the autosave loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, onSave]);

  return (
    <div className="mt-3 space-y-3 rounded border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-wider text-slate-400">Observations</span>
        <span className="flex items-center gap-2">
          {status === "pending" && <span className="text-slate-400">Saving…</span>}
          {status === "saved" && <span className="text-emerald-300">Saved</span>}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-600"
          >
            Done
          </button>
        </span>
      </div>
      <TaskFormRenderer task={task} value={draft} onChange={setDraft} />
    </div>
  );
}

function FreeTextNote({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (notes: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="mt-2 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Per-stop note"
        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
      />
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-600"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => onSave(text)}
        className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-400"
      >
        Save
      </button>
    </div>
  );
}

function AssetPicker({
  existingUids,
  defaultClass,
  onClose,
  onAdd,
  isPending,
}: {
  existingUids: Set<string>;
  /** When the WO already has stops, default the class filter to the
   * most-common existing class so adding the second asset doesn't make
   * the operator re-pick it from scratch. */
  defaultClass?: string;
  onClose: () => void;
  onAdd: (uids: string[]) => void;
  isPending: boolean;
}) {
  const [q, setQ] = useState("");
  const [classCode, setClassCode] = useState(defaultClass ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const assetsQuery = useAssets(
    { q, class: classCode || undefined, page_size: 50 },
    q.length >= 1 || !!classCode,
  );

  function togglePick(uid: string) {
    const next = new Set(picked);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setPicked(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-100">Add assets to this WO</h3>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by UID, material…"
              className="flex-1 rounded border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100"
              autoFocus
            />
            <select
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">Any class</option>
              <option value="WAT_HYD">WAT_HYD</option>
              <option value="WAT_VLV">WAT_VLV</option>
              <option value="WAT_MAIN">WAT_MAIN</option>
              <option value="WAT_SVC">WAT_SVC</option>
              <option value="SAN_MAIN">SAN_MAIN</option>
              <option value="SAN_MH">SAN_MH</option>
              <option value="SAN_LFT">SAN_LFT</option>
              <option value="STM_CB">STM_CB</option>
              <option value="STM_MH">STM_MH</option>
              <option value="STM_DTCH">STM_DTCH</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {assetsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {assetsQuery.data?.items.length === 0 && (
            <p className="text-sm text-slate-500">No matches.</p>
          )}
          <ul className="space-y-1">
            {(assetsQuery.data?.items ?? []).map((a) => {
              const already = existingUids.has(a.asset_uid);
              const isPicked = picked.has(a.asset_uid);
              return (
                <li key={a.asset_uid}>
                  <button
                    type="button"
                    onClick={() => !already && togglePick(a.asset_uid)}
                    disabled={already}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-left ${
                      already
                        ? "border-slate-800 bg-slate-900/40 text-slate-500"
                        : isPicked
                          ? "border-blue-500/50 bg-blue-500/15 text-slate-100"
                          : "border-slate-800 bg-slate-950/60 text-slate-200 hover:border-slate-700"
                    }`}
                  >
                    <span className="font-mono text-sm">
                      {isPicked && !already ? "✓ " : "  "}
                      {a.asset_uid}
                    </span>
                    <span className="text-xs text-slate-400">
                      {a.class_code}
                      {already && " · already on WO"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">{picked.size} selected</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={picked.size === 0 || isPending}
              onClick={() => onAdd(Array.from(picked))}
              className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400 disabled:opacity-50"
            >
              {isPending ? "Adding…" : `Add ${picked.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
