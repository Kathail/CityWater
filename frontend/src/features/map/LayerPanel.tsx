import type { TileLayerDescriptor } from "./api";
import { BASEMAP_OPTIONS, type BasemapId } from "./basemap";

interface Props {
  layers: TileLayerDescriptor[];
  visibleClasses: Set<string>;
  onToggle: (classCode: string, visible: boolean) => void;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  showWos?: boolean;
  showSrs?: boolean;
  onToggleWos?: (v: boolean) => void;
  onToggleSrs?: (v: boolean) => void;
  woCount?: number;
  srCount?: number;
}

export function LayerPanel({
  layers,
  visibleClasses,
  onToggle,
  basemap,
  onBasemapChange,
  showWos = true,
  showSrs = true,
  onToggleWos,
  onToggleSrs,
  woCount = 0,
  srCount = 0,
}: Props) {
  const byDomain = layers.reduce<Record<string, TileLayerDescriptor[]>>((acc, l) => {
    (acc[l.domain] ??= []).push(l);
    return acc;
  }, {});
  const domains: { id: string; label: string }[] = [
    { id: "water", label: "Water" },
    { id: "sewer", label: "Sewer" },
    { id: "storm", label: "Storm" },
  ];

  return (
    <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-900 p-4 overflow-y-auto">
      <section aria-labelledby="basemap-heading" className="mb-4">
        <h2 id="basemap-heading" className="text-xs font-medium uppercase text-slate-400">
          Basemap
        </h2>
        <select
          value={basemap}
          onChange={(e) => onBasemapChange(e.target.value as BasemapId)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
          aria-label="Basemap"
        >
          {BASEMAP_OPTIONS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </section>

      <section aria-labelledby="ops-heading" className="mb-4">
        <h2 id="ops-heading" className="text-xs font-medium uppercase text-slate-400 mb-1">
          Operational
        </h2>
        <ul className="space-y-1">
          <li>
            <label className="flex items-center gap-2 cursor-pointer text-sm hover:bg-slate-800/50 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={showWos}
                onChange={(e) => onToggleWos?.(e.target.checked)}
                aria-label="Toggle open work orders"
              />
              <span
                className="inline-block h-3 w-3 rounded-full border-2 border-blue-400"
                aria-hidden="true"
              />
              <span className="text-slate-200">Open work orders</span>
              <span className="ml-auto text-xs tabular-nums text-slate-400">
                {woCount}
              </span>
            </label>
          </li>
          <li>
            <label className="flex items-center gap-2 cursor-pointer text-sm hover:bg-slate-800/50 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={showSrs}
                onChange={(e) => onToggleSrs?.(e.target.checked)}
                aria-label="Toggle active service requests"
              />
              <span
                className="inline-block h-3 w-3 rounded-full bg-amber-500"
                aria-hidden="true"
              />
              <span className="text-slate-200">Active service requests</span>
              <span className="ml-auto text-xs tabular-nums text-slate-400">
                {srCount}
              </span>
            </label>
          </li>
        </ul>
      </section>

      {domains.map((d) => {
        const ls = byDomain[d.id] ?? [];
        if (ls.length === 0) return null;
        return (
          <section key={d.id} aria-labelledby={`heading-${d.id}`} className="mb-4">
            <h2
              id={`heading-${d.id}`}
              className="text-xs font-medium uppercase text-slate-400 mb-1"
            >
              {d.label}
            </h2>
            <ul className="space-y-1">
              {ls.map((l) => {
                const checked = visibleClasses.has(l.class_code);
                return (
                  <li key={l.class_code}>
                    <label className="flex items-center gap-2 cursor-pointer text-sm hover:bg-slate-800/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onToggle(l.class_code, e.target.checked)}
                        aria-label={`Toggle ${l.name}`}
                      />
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-slate-700"
                        style={{ backgroundColor: l.color ?? "#888" }}
                        aria-hidden="true"
                      />
                      <span className="text-slate-200">{l.name}</span>
                      <span className="ml-auto text-xs text-slate-400 font-mono">
                        {l.class_code}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
