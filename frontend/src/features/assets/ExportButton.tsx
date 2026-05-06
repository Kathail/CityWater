import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { exportAssetsUrl } from "./api";

export function ExportButton() {
  const [search] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [includeFilters, setIncludeFilters] = useState(true);

  const filters = includeFilters
    ? {
        class: search.get("class") ?? undefined,
        domain: search.get("domain") ?? undefined,
        status: search.get("status") ?? undefined,
        q: search.get("q") ?? undefined,
        bbox: search.get("bbox") ?? undefined,
      }
    : {};

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Export…
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 rounded-md border border-slate-200 bg-white shadow-lg z-20 p-3 space-y-2"
          onMouseLeave={() => setOpen(false)}
        >
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeFilters}
              onChange={(e) => setIncludeFilters(e.target.checked)}
            />
            Apply current filters
          </label>
          <div className="flex gap-2">
            <a
              href={exportAssetsUrl("csv", filters)}
              download
              className="flex-1 text-center rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
              role="menuitem"
            >
              CSV
            </a>
            <a
              href={exportAssetsUrl("geojson", filters)}
              download
              className="flex-1 text-center rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
              role="menuitem"
            >
              GeoJSON
            </a>
          </div>
          <p className="text-xs text-slate-500">
            CSV is Point-only. Lines/polygons round-trip via GeoJSON.
          </p>
        </div>
      )}
    </div>
  );
}
