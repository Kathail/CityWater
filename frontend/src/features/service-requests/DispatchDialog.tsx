import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { translateApiError } from "../../lib/translateApiError";
import type { DispatchInput, SrPriority } from "./api";
import { useDispatchServiceRequest } from "./hooks";

const CATEGORIES = [
  "main_break",
  "flushing",
  "valve_exercise",
  "cleaning",
  "inspection",
  "investigation",
  "repair",
  "install",
  "other",
] as const;

const PRIORITIES: SrPriority[] = ["low", "normal", "high", "emergency"];

interface Props {
  srNumber: string;
  defaultPriority: SrPriority;
  /** Source SR fields used to pre-fill the WO so the dispatcher doesn't
   * retype the same context. The dispatcher can edit any of these
   * before submitting. */
  srDescription?: string | null;
  srCategory?: string;
  srAssetUid?: string | null;
  onClose: () => void;
  onDispatched: (woNumber: string) => void;
}

/** Map SR categories onto the closest WO category. WO categories are a
 * narrower set of operational verbs ("flushing", "cleaning"); SRs are
 * intake taxonomies ("discoloured_water", "sewer_backup"). The mapping
 * here is "what crew does the dispatcher most likely send" — they can
 * still override before submitting. */
const SR_TO_WO_CATEGORY: Record<string, (typeof CATEGORIES)[number]> = {
  main_break: "main_break",
  low_pressure: "investigation",
  no_water: "investigation",
  sewer_backup: "cleaning",
  flooding: "cleaning",
  odour: "investigation",
  damaged_asset: "repair",
  discoloured_water: "flushing",
  water_quality: "flushing",
  service_leak: "repair",
};

/** Truncate the SR description to a reasonable WO title (140 char). */
function deriveTitle(srNumber: string, description: string | null | undefined): string {
  const desc = (description ?? "").trim();
  if (!desc) return `Investigate ${srNumber}`;
  // First sentence or first 140 chars, whichever is shorter.
  const firstSentence = desc.split(/[.!?\n]/)[0].trim();
  const candidate = firstSentence || desc;
  return candidate.length > 140 ? `${candidate.slice(0, 137)}…` : candidate;
}

export function DispatchDialog({
  srNumber,
  defaultPriority,
  srDescription,
  srCategory,
  srAssetUid,
  onClose,
  onDispatched,
}: Props) {
  const dispatch = useDispatchServiceRequest(srNumber);
  const [form, setForm] = useState<DispatchInput["work_order"]>({
    title: deriveTitle(srNumber, srDescription),
    description: "",
    category: (srCategory && SR_TO_WO_CATEGORY[srCategory]) || "repair",
    priority: defaultPriority,
    asset_uid: srAssetUid ?? "",
    scheduled_for: "",
    due_by: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    try {
      const sr = await dispatch.mutateAsync({
        work_order: {
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          priority: form.priority,
          asset_uid: form.asset_uid || undefined,
          // SR-P1: surface scheduled_for + due_by so dispatchers don't
          // have to bounce into the WO detail page just to set a date
          // after dispatching. Local datetime-input values are passed
          // straight to the backend, which interprets them as the
          // tenant's local timezone.
          scheduled_for: form.scheduled_for || undefined,
          due_by: form.due_by || undefined,
        },
      });
      if (sr.work_order_number) onDispatched(sr.work_order_number);
    } catch (err) {
      setErrorMessage(translateApiError(err));
    }
  }

  // Close on Escape, matching ConfirmDialog's keyboard contract.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !dispatch.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dispatch.isPending]);

  const inputClass = "mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispatch-dialog-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !dispatch.isPending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-3 rounded-lg bg-slate-900 p-6 shadow-lg"
      >
        <h2 id="dispatch-dialog-title" className="text-lg font-semibold text-slate-100">
          Dispatch as work order
        </h2>
        <p className="text-xs text-slate-400">
          Creates a new WO linked to {srNumber} and moves the SR to{" "}
          <span className="font-medium">dispatched</span>.
        </p>

        <label className="block text-sm">
          <span className="text-slate-200">
            Title{" "}
            <span className="text-red-400" aria-hidden="true">
              *
            </span>
          </span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            aria-required="true"
            autoFocus
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate-200">Category</span>
            <select
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  category: e.target.value as (typeof CATEGORIES)[number],
                }))
              }
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-200">Priority</span>
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as SrPriority }))}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-200">Asset UID (optional)</span>
          <input
            value={form.asset_uid}
            onChange={(e) => setForm((f) => ({ ...f, asset_uid: e.target.value }))}
            placeholder="HYD-00001"
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate-200">Scheduled for (optional)</span>
            <input
              type="datetime-local"
              value={form.scheduled_for ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, scheduled_for: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-200">Due by (optional)</span>
            <input
              type="datetime-local"
              value={form.due_by ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, due_by: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-200">Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className={inputClass}
          />
        </label>

        {errorMessage && <Alert>{errorMessage}</Alert>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={dispatch.isPending}>
            {dispatch.isPending ? "Dispatching…" : "Dispatch"}
          </Button>
        </div>
      </form>
    </div>
  );
}
