import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import type { DispatchInput, SrPriority } from "./api";
import { useDispatchServiceRequest } from "./hooks";

const CATEGORIES = [
  "main_break",
  "flushing",
  "valve_exercise",
  "cleaning",
  "inspection",
  "repair",
  "install",
  "other",
] as const;

const PRIORITIES: SrPriority[] = ["low", "normal", "high", "emergency"];

interface Props {
  srNumber: string;
  defaultPriority: SrPriority;
  onClose: () => void;
  onDispatched: (woNumber: string) => void;
}

export function DispatchDialog({ srNumber, defaultPriority, onClose, onDispatched }: Props) {
  const dispatch = useDispatchServiceRequest(srNumber);
  const [form, setForm] = useState<DispatchInput["work_order"]>({
    title: "",
    description: "",
    category: "repair",
    priority: defaultPriority,
    asset_uid: "",
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
        },
      });
      if (sr.work_order_number) onDispatched(sr.work_order_number);
    } catch (err) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage(String(err));
    }
  }

  const inputClass =
    "mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-3 rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          Dispatch as work order
        </h2>
        <p className="text-xs text-slate-500">
          Creates a new WO linked to {srNumber} and moves the SR to{" "}
          <span className="font-medium">dispatched</span>.
        </p>

        <label className="block text-sm">
          <span className="text-slate-700">Title</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate-700">Category</span>
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
            <span className="text-slate-700">Priority</span>
            <select
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: e.target.value as SrPriority }))
              }
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
          <span className="text-slate-700">Asset UID (optional)</span>
          <input
            value={form.asset_uid}
            onChange={(e) =>
              setForm((f) => ({ ...f, asset_uid: e.target.value }))
            }
            placeholder="HYD-00001"
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            className={inputClass}
          />
        </label>

        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={dispatch.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {dispatch.isPending ? "Dispatching…" : "Dispatch"}
          </button>
        </div>
      </form>
    </div>
  );
}
