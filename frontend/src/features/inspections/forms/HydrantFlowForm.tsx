import { useEffect, useMemo, useState } from "react";

interface Props {
  onChange: (data: Record<string, unknown>) => void;
}

function gpmAt20(static_psi: number, residual_psi: number, flow_gpm: number): number | null {
  if (static_psi <= 20 || static_psi <= residual_psi) return null;
  const ratio = (static_psi - 20) / (static_psi - residual_psi);
  if (ratio <= 0) return null;
  return Math.round(flow_gpm * ratio ** 0.54);
}

function colorClass(g: number | null): string | null {
  if (g === null) return null;
  if (g >= 1500) return "blue";
  if (g >= 1000) return "green";
  if (g >= 500) return "orange";
  return "red";
}

const SWATCH: Record<string, string> = {
  blue: "#1e88e5",
  green: "#43a047",
  orange: "#fb8c00",
  red: "#e53935",
};

export function HydrantFlowForm({ onChange }: Props) {
  const [v, setV] = useState({
    static_psi: "",
    residual_psi: "",
    flow_gpm: "",
    pitot_psi: "",
    outlet_size_mm: "",
    coefficient: "",
  });

  const preview = useMemo(() => {
    const s = Number(v.static_psi);
    const r = Number(v.residual_psi);
    const f = Number(v.flow_gpm);
    if (!v.static_psi || !v.residual_psi || !v.flow_gpm) return null;
    const g = gpmAt20(s, r, f);
    return { gpm20: g, color: colorClass(g) };
  }, [v]);

  useEffect(() => {
    const payload: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== "") {
        payload[k] = k === "coefficient" ? Number(val) : Number(val);
      }
    }
    onChange(payload);
  }, [v, onChange]);

  function field(key: keyof typeof v, label: string, type = "number") {
    return (
      <label className="block">
        <span className="text-xs text-slate-600">{label}</span>
        <input
          type={type}
          step={key === "coefficient" ? "0.01" : "1"}
          value={v[key]}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {field("static_psi", "Static PSI")}
        {field("residual_psi", "Residual PSI")}
        {field("flow_gpm", "Flow GPM")}
        {field("pitot_psi", "Pitot PSI")}
        {field("outlet_size_mm", "Outlet (mm)")}
        {field("coefficient", "Coefficient")}
      </div>
      {preview && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs uppercase text-slate-500">Server will compute</p>
          <p className="mt-1">
            <span className="font-mono">calc_gpm_at_20psi</span> = {preview.gpm20 ?? "—"}
          </p>
          <p className="flex items-center gap-2 mt-1">
            <span className="font-mono">color_class</span> = {preview.color ?? "—"}
            {preview.color && (
              <span
                className="inline-block w-4 h-4 rounded-sm border border-slate-300"
                style={{ backgroundColor: SWATCH[preview.color] ?? "#888" }}
                aria-hidden="true"
              />
            )}
          </p>
        </div>
      )}
    </div>
  );
}
