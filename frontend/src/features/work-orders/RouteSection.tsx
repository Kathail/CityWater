import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAssets } from "../assets/hooks";
import {
  addWoAssets,
  removeWoAsset,
  updateWoAsset,
  type WoAsset,
  type WorkOrderDetail,
} from "./api";

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
}: {
  wo: WorkOrderDetail;
  slug: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const completed = wo.assets.filter((a) => a.completed_at).length;
  const total = wo.assets.length;

  const update = useMutation({
    mutationFn: (vars: { uid: string; patch: Parameters<typeof updateWoAsset>[2] }) =>
      updateWoAsset(wo.wo_number, vars.uid, vars.patch),
    onSuccess: (next) =>
      queryClient.setQueryData(["work-order", wo.wo_number], next),
  });
  const remove = useMutation({
    mutationFn: (uid: string) => removeWoAsset(wo.wo_number, uid),
    onSuccess: (next) =>
      queryClient.setQueryData(["work-order", wo.wo_number], next),
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
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400"
        >
          + Add assets
        </button>
      </div>

      {wo.assets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No assets attached. Tap <em>Add assets</em> to build the route.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {wo.assets.map((a) => (
            <RouteRow
              key={a.asset_uid}
              asset={a}
              slug={slug}
              onToggle={(complete) =>
                update.mutate({ uid: a.asset_uid, patch: { mark_complete: complete } })
              }
              onNotes={(notes) =>
                update.mutate({
                  uid: a.asset_uid,
                  patch: { completion_notes: notes },
                })
              }
              onRemove={() => {
                if (window.confirm(`Remove ${a.asset_uid} from this WO?`)) {
                  remove.mutate(a.asset_uid);
                }
              }}
            />
          ))}
        </ol>
      )}

      {pickerOpen && (
        <AssetPicker
          existingUids={new Set(wo.assets.map((a) => a.asset_uid))}
          onClose={() => setPickerOpen(false)}
          onAdd={(uids) => add.mutate(uids)}
          isPending={add.isPending}
        />
      )}
    </section>
  );
}

function RouteRow({
  asset,
  slug,
  onToggle,
  onNotes,
  onRemove,
}: {
  asset: WoAsset;
  slug: string | undefined;
  onToggle: (complete: boolean) => void;
  onNotes: (notes: string) => void;
  onRemove: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState(asset.completion_notes ?? "");
  const checked = !!asset.completed_at;

  return (
    <li
      className={`rounded-md border p-3 ${
        checked
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-slate-800 bg-slate-950/60"
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
                {notesOpen ? "Hide" : asset.completion_notes ? "Note ✎" : "+ Note"}
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
          {asset.completion_notes && !notesOpen && (
            <p className="mt-1 text-xs text-slate-300">— {asset.completion_notes}</p>
          )}
          {notesOpen && (
            <div className="mt-2 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Per-stop note (e.g. flushed 8 min)"
                className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  onNotes(draft);
                  setNotesOpen(false);
                }}
                className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-400"
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function AssetPicker({
  existingUids,
  onClose,
  onAdd,
  isPending,
}: {
  existingUids: Set<string>;
  onClose: () => void;
  onAdd: (uids: string[]) => void;
  isPending: boolean;
}) {
  const [q, setQ] = useState("");
  const [classCode, setClassCode] = useState("");
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
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
            >
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
          <p className="text-xs text-slate-400">
            {picked.size} selected
          </p>
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
