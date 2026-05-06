import type { TileLayerDescriptor } from "./api";
import { BASEMAP_OPTIONS, type BasemapId } from "./basemap";

interface Props {
  layers: TileLayerDescriptor[];
  visibleClasses: Set<string>;
  onToggle: (classCode: string, visible: boolean) => void;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
}

export function LayerPanel({ layers, visibleClasses, onToggle, basemap, onBasemapChange }: Props) {
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
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto">
      <section aria-labelledby="basemap-heading" className="mb-4">
        <h2 id="basemap-heading" className="text-xs font-medium uppercase text-slate-500">
          Basemap
        </h2>
        <select
          value={basemap}
          onChange={(e) => onBasemapChange(e.target.value as BasemapId)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          aria-label="Basemap"
        >
          {BASEMAP_OPTIONS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </section>

      {domains.map((d) => {
        const ls = byDomain[d.id] ?? [];
        if (ls.length === 0) return null;
        return (
          <section key={d.id} aria-labelledby={`heading-${d.id}`} className="mb-4">
            <h2
              id={`heading-${d.id}`}
              className="text-xs font-medium uppercase text-slate-500 mb-1"
            >
              {d.label}
            </h2>
            <ul className="space-y-1">
              {ls.map((l) => {
                const checked = visibleClasses.has(l.class_code);
                return (
                  <li key={l.class_code}>
                    <label className="flex items-center gap-2 cursor-pointer text-sm hover:bg-slate-50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onToggle(l.class_code, e.target.checked)}
                        aria-label={`Toggle ${l.name}`}
                      />
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                        style={{ backgroundColor: l.color ?? "#888" }}
                        aria-hidden="true"
                      />
                      <span className="text-slate-700">{l.name}</span>
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
