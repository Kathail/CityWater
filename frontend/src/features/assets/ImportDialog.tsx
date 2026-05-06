import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { translateApiError } from "../../lib/translateApiError";
import { importAssets, type ImportResult } from "./api";

interface Props {
  onClose: () => void;
}

export function ImportDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [onConflict, setOnConflict] = useState<"skip" | "update">("skip");
  const [dryRun, setDryRun] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const upload = useMutation<ImportResult, Error>({
    mutationFn: () => {
      if (!file) throw new Error("Pick a file first");
      return importAssets({ file, on_conflict: onConflict, dry_run: dryRun });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset"] });
    },
    onError: (err) => setErrorMessage(translateApiError(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    upload.mutate();
  }

  // Esc to close (when not in the middle of an upload).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !upload.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, upload.isPending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !upload.isPending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-lg bg-slate-900 p-5 shadow-xl space-y-3"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="import-title" className="text-lg font-semibold text-slate-100">
              Import assets
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              CSV (Point-only) or GeoJSON FeatureCollection. Max 10 MB.
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
          <span className="text-xs text-slate-300">File</span>
          <input
            type="file"
            accept=".csv,.json,.geojson,application/geo+json,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </label>

        <div className="flex gap-4">
          <label className="block flex-1">
            <span className="text-xs text-slate-300">If asset_uid already exists</span>
            <select
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as "skip" | "update")}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              <option value="skip">Skip (default)</option>
              <option value="update">Update existing</option>
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm pb-1">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>Dry run (validate only)</span>
          </label>
        </div>

        {errorMessage && <Alert>{errorMessage}</Alert>}

        {upload.data && (
          <div className="rounded border border-slate-800 bg-slate-800/50 p-3 space-y-2">
            <p className="text-sm font-medium text-slate-100">
              {dryRun ? "Dry-run result" : "Import complete"}
            </p>
            <ul className="text-sm text-slate-200">
              <li>Created: {upload.data.summary.created}</li>
              <li>Updated: {upload.data.summary.updated}</li>
              <li>Skipped: {upload.data.summary.skipped}</li>
              <li>Failed: {upload.data.summary.failed}</li>
            </ul>
            {upload.data.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-300 hover:text-slate-100">
                  {upload.data.errors.length} error
                  {upload.data.errors.length === 1 ? "" : "s"} — show
                </summary>
                <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
                  {upload.data.errors.map((e, i) => (
                    <li key={i} className="text-slate-200">
                      <span className="font-mono text-slate-400">row {e.row}</span> —{" "}
                      <span className="font-mono">{e.code}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {upload.data ? "Close" : "Cancel"}
          </Button>
          {!upload.data && (
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? "Uploading…" : "Import"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
