import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { translateApiError } from "../../lib/translateApiError";
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
  /** Prefill the form (used when launched via deep-link from another page). */
  defaults?: {
    asset_uid?: string;
    title?: string;
    category?: WoCategory;
    priority?: WoPriority;
    type?: WoType;
    description?: string;
  };
}

export function CreateWorkOrderDialog({ onClose, defaults }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const templatesQuery = useTemplates();
  const [form, setForm] = useState({
    title: defaults?.title ?? "",
    type: defaults?.type ?? ("reactive" as WoType),
    category: defaults?.category ?? ("other" as WoCategory),
    priority: defaults?.priority ?? ("normal" as WoPriority),
    description: defaults?.description ?? "",
    asset_uid: defaults?.asset_uid ?? "",
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
    onError: (err) => setErrorMessage(translateApiError(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    create.mutate();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !create.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, create.isPending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wo-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !create.isPending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-lg bg-slate-900 p-5 shadow-xl space-y-3"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="new-wo-title" className="text-lg font-semibold text-slate-100">
              New work order
            </h2>
            <p className="text-xs text-slate-500">
              Tenant: <span className="text-slate-300">{slug}</span>
            </p>
          </div>
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
          <span className="text-xs text-slate-300">
            Title{" "}
            <span className="text-red-400" aria-hidden="true">
              *
            </span>
          </span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            aria-required="true"
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

        {errorMessage && <Alert>{errorMessage}</Alert>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!form.title || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
