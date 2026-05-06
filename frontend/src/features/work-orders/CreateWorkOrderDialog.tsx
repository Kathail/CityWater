import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import {
  createWorkOrder,
  type WoCategory,
  type WoPriority,
  type WoType,
  type WorkOrderDetail,
} from "./api";
import { useTemplates } from "./hooks";

const CATEGORIES: WoCategory[] = [
  "main_break",
  "flushing",
  "valve_exercise",
  "cleaning",
  "inspection",
  "investigation",
  "repair",
  "install",
  "other",
];
const PRIORITIES: WoPriority[] = ["low", "normal", "high", "emergency"];
const TYPES: WoType[] = ["planned", "reactive"];

interface Props {
  onClose: () => void;
}

export function CreateWorkOrderDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const templatesQuery = useTemplates();
  const [form, setForm] = useState({
    title: "",
    type: "reactive" as WoType,
    category: "other" as WoCategory,
    priority: "normal" as WoPriority,
    description: "",
    asset_uid: "",
    from_template_id: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useMutation<WorkOrderDetail, Error>({
    mutationFn: () =>
      createWorkOrder({
        title: form.title,
        type: form.type,
        category: form.category,
        priority: form.priority,
        description: form.description || undefined,
        asset_uid: form.asset_uid || undefined,
        from_template_id: form.from_template_id || undefined,
      }),
    onSuccess: (wo) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      navigate(`/${slug}/work-orders/${wo.wo_number}`);
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiError ? err.message : err.message);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    create.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wo-title"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-lg bg-slate-900 p-5 shadow-xl space-y-3"
      >
        <header className="flex items-start justify-between">
          <h2 id="new-wo-title" className="text-lg font-semibold text-slate-100">
            New work order
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <label className="block">
          <span className="text-xs text-slate-300">Title</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-slate-300">Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as WoType })}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-300">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as WoCategory })}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-300">Priority</span>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as WoPriority })}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-slate-300">Asset UID (optional)</span>
          <input
            value={form.asset_uid}
            onChange={(e) => setForm({ ...form, asset_uid: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs text-slate-300">From template (optional)</span>
          <select
            value={form.from_template_id}
            onChange={(e) => setForm({ ...form, from_template_id: Number(e.target.value) })}
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
          >
            <option value={0}>None</option>
            {templatesQuery.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-slate-300">Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!form.title || create.isPending}
            className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-400 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
