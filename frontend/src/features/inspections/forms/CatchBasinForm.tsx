import { useEffect, useState } from "react";

interface Props {
  onChange: (data: Record<string, unknown>) => void;
}

export function CatchBasinForm({ onChange }: Props) {
  const [v, setV] = useState({
    grate_condition: "3",
    sump_depth_m: "",
    sediment_depth_m: "",
    needs_cleaning: false,
    blockage: false,
  });

  useEffect(() => {
    const out: Record<string, unknown> = {
      grate_condition: Number(v.grate_condition),
      needs_cleaning: v.needs_cleaning,
      blockage: v.blockage,
    };
    if (v.sump_depth_m) out.sump_depth_m = v.sump_depth_m;
    if (v.sediment_depth_m) out.sediment_depth_m = v.sediment_depth_m;
    onChange(out);
  }, [v, onChange]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs text-slate-600">Grate condition</span>
          <select
            value={v.grate_condition}
            onChange={(e) => setV({ ...v, grate_condition: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm bg-white"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Sump depth (m)</span>
          <input
            type="number"
            step="0.1"
            value={v.sump_depth_m}
            onChange={(e) => setV({ ...v, sump_depth_m: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Sediment (m)</span>
          <input
            type="number"
            step="0.1"
            value={v.sediment_depth_m}
            onChange={(e) => setV({ ...v, sediment_depth_m: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>
      <fieldset className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.needs_cleaning}
            onChange={(e) => setV({ ...v, needs_cleaning: e.target.checked })}
          />
          <span>Needs cleaning</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.blockage}
            onChange={(e) => setV({ ...v, blockage: e.target.checked })}
          />
          <span>Blockage</span>
        </label>
      </fieldset>
    </div>
  );
}
