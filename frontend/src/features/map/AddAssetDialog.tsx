import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/apiClient";
import { useAssetClasses } from "../assets/hooks";
import { createAsset, type AssetOut } from "../assets/api";

interface Props {
  /** Click coordinates [lon, lat] to populate the asset's geometry */
  coords: [number, number];
  onClose: () => void;
  onCreated: (asset: AssetOut) => void;
}

export function AddAssetDialog({ coords, onClose, onCreated }: Props) {
  const classesQuery = useAssetClasses();
  const queryClient = useQueryClient();
  const [classCode, setClassCode] = useState("");
  const [material, setMaterial] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pointClasses = (classesQuery.data ?? []).filter(
    (c) => c.geometry_type === "Point" && c.is_active,
  );

  const create = useMutation<AssetOut, Error>({
    mutationFn: () =>
      createAsset({
        class_code: classCode,
        geometry: { type: "Point", coordinates: coords },
        material: material || undefined,
      }),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["tile-layers"] });
      onCreated(asset);
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiError ? err.message : err.message);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!classCode) {
      setErrorMessage("Pick a class");
      return;
    }
    setErrorMessage(null);
    create.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-asset-title"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="add-asset-title" className="text-lg font-semibold text-slate-900">
              Add asset here
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-1">
              {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <label className="block">
          <span className="text-xs text-slate-600">Asset class</span>
          <select
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm bg-white"
          >
            <option value="">Pick a class…</option>
            {pointClasses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500 mt-1 block">
            Map creates Point assets only. Lines/polygons via API for now.
          </span>
        </label>

        <label className="block">
          <span className="text-xs text-slate-600">Material (optional)</span>
          <input
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create asset"}
          </button>
        </div>
      </form>
    </div>
  );
}
