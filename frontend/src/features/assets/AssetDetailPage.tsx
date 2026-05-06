import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import { deleteAsset, updateAsset, type AssetOut, type AssetUpdateInput } from "./api";
import { useAsset } from "./hooks";

const STATUSES = ["active", "abandoned", "removed", "proposed"] as const;

interface FormState {
  material: string;
  diameter_mm: string;
  manufacturer: string;
  model: string;
  install_date: string;
  condition: string;
  criticality: string;
  status: (typeof STATUSES)[number];
  notes: string;
}

function toFormState(a: AssetOut): FormState {
  return {
    material: a.material ?? "",
    diameter_mm: a.diameter_mm?.toString() ?? "",
    manufacturer: a.manufacturer ?? "",
    model: a.model ?? "",
    install_date: a.install_date ?? "",
    condition: a.condition?.toString() ?? "",
    criticality: a.criticality?.toString() ?? "",
    status: a.status,
    notes: a.notes ?? "",
  };
}

function diff(prev: AssetOut, next: FormState): AssetUpdateInput {
  const out: AssetUpdateInput = {};
  const setIf = <K extends keyof AssetUpdateInput>(
    key: K,
    incoming: AssetUpdateInput[K],
    current: AssetUpdateInput[K],
  ) => {
    if (incoming !== current) out[key] = incoming;
  };
  setIf("material", next.material || null, prev.material);
  setIf("diameter_mm", next.diameter_mm === "" ? null : Number(next.diameter_mm), prev.diameter_mm);
  setIf("manufacturer", next.manufacturer || null, prev.manufacturer);
  setIf("model", next.model || null, prev.model);
  setIf("install_date", next.install_date || null, prev.install_date);
  setIf("condition", next.condition === "" ? null : Number(next.condition), prev.condition);
  setIf("criticality", next.criticality === "" ? null : Number(next.criticality), prev.criticality);
  setIf("status", next.status, prev.status);
  setIf("notes", next.notes || null, prev.notes);
  return out;
}

export function AssetDetailPage() {
  const params = useParams<{ slug: string; uid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assetQuery = useAsset(params.uid);
  const [form, setForm] = useState<FormState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (assetQuery.data) setForm(toFormState(assetQuery.data));
  }, [assetQuery.data]);

  const save = useMutation<AssetOut, Error, AssetUpdateInput>({
    mutationFn: (patch) => updateAsset(params.uid!, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(["asset", params.uid], saved);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setForm(toFormState(saved));
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiError ? err.message : err.message);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteAsset(params.uid!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      navigate(`/${params.slug}/assets`);
    },
  });

  if (assetQuery.isLoading || !form) {
    return <div className="text-slate-500">Loading…</div>;
  }
  if (assetQuery.error) {
    return <div className="text-red-600">{assetQuery.error.message}</div>;
  }
  const asset = assetQuery.data!;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !assetQuery.data) return;
    const patch = diff(assetQuery.data, form);
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  }

  return (
    <div className="p-8 max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/${params.slug}/assets`} className="text-sm text-slate-500 hover:underline">
            ← Back to assets
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900 mt-1">{asset.asset_uid}</h1>
          <p className="text-sm text-slate-600">
            {asset.class_code} · {asset.domain}
          </p>
        </div>
        <button
          onClick={() => {
            if (confirm(`Soft-delete ${asset.asset_uid}?`)) remove.mutate();
          }}
          disabled={remove.isPending}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
      >
        {errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Material">
            <input
              value={form.material}
              onChange={(e) => update("material", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Diameter (mm)">
            <input
              type="number"
              value={form.diameter_mm}
              onChange={(e) => update("diameter_mm", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Manufacturer">
            <input
              value={form.manufacturer}
              onChange={(e) => update("manufacturer", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Model">
            <input
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Install date">
            <input
              type="date"
              value={form.install_date}
              onChange={(e) => update("install_date", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value as FormState["status"])}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm bg-white"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={form.condition}
              onChange={(e) => update("condition", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Criticality (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={form.criticality}
              onChange={(e) => update("criticality", e.target.value)}
              className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={3}
            className="block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </Field>
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="text-sm font-medium text-slate-700 cursor-pointer">
          Geometry (raw GeoJSON)
        </summary>
        <pre className="mt-3 overflow-x-auto text-xs text-slate-700">
          {JSON.stringify(asset.geometry, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
