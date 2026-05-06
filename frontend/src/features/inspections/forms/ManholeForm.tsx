import { useEffect, useState } from "react";

interface Props {
  onChange: (data: Record<string, unknown>) => void;
}

const CONDITION_FIELDS: { key: string; label: string }[] = [
  { key: "frame_cover_condition", label: "Frame/cover" },
  { key: "chimney_condition", label: "Chimney" },
  { key: "cone_condition", label: "Cone" },
  { key: "wall_condition", label: "Wall" },
  { key: "bench_channel_condition", label: "Bench/channel" },
];

export function ManholeForm({ onChange }: Props) {
  const [v, setV] = useState<Record<string, string>>({
    frame_cover_condition: "3",
    chimney_condition: "3",
    cone_condition: "3",
    wall_condition: "3",
    bench_channel_condition: "3",
    infiltration_lpm: "",
    depth_m: "",
    h2s_ppm: "",
  });

  useEffect(() => {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === "") continue;
      if (k.endsWith("_condition") || k === "h2s_ppm") {
        out[k] = Number(val);
      } else {
        out[k] = val;
      }
    }
    onChange(out);
  }, [v, onChange]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        {CONDITION_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-xs text-slate-600">{f.label}</span>
            <select
              value={v[f.key]}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm bg-white"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs text-slate-600">Infiltration (LPM)</span>
          <input
            type="number"
            step="0.1"
            value={v.infiltration_lpm}
            onChange={(e) => setV({ ...v, infiltration_lpm: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Depth (m)</span>
          <input
            type="number"
            step="0.1"
            value={v.depth_m}
            onChange={(e) => setV({ ...v, depth_m: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">H₂S (ppm)</span>
          <input
            type="number"
            value={v.h2s_ppm}
            onChange={(e) => setV({ ...v, h2s_ppm: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
