import { useEffect, useState } from "react";

interface Props {
  onChange: (data: Record<string, unknown>) => void;
}

export function LiftStationForm({ onChange }: Props) {
  const [v, setV] = useState({
    wet_well_level_m: "",
    pump1_runtime_h: "",
    pump2_runtime_h: "",
    pump1_amps: "",
    pump2_amps: "",
    alarms: "",
    generator_test_pass: true,
    odour_pass: true,
  });

  useEffect(() => {
    const out: Record<string, unknown> = {
      generator_test_pass: v.generator_test_pass,
      odour_pass: v.odour_pass,
      alarms: v.alarms
        ? v.alarms
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    };
    for (const k of [
      "wet_well_level_m",
      "pump1_runtime_h",
      "pump2_runtime_h",
      "pump1_amps",
      "pump2_amps",
    ] as const) {
      if (v[k]) out[k] = v[k];
    }
    onChange(out);
  }, [v, onChange]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["wet_well_level_m", "Wet well (m)"],
            ["pump1_runtime_h", "Pump 1 runtime (h)"],
            ["pump2_runtime_h", "Pump 2 runtime (h)"],
            ["pump1_amps", "Pump 1 amps"],
            ["pump2_amps", "Pump 2 amps"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block">
            <span className="text-xs text-slate-600">{label}</span>
            <input
              type="number"
              step="0.1"
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="text-xs text-slate-600">Alarms (comma-separated)</span>
        <input
          value={v.alarms}
          onChange={(e) => setV({ ...v, alarms: e.target.value })}
          placeholder="high_level, motor_overload"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <fieldset className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.generator_test_pass}
            onChange={(e) => setV({ ...v, generator_test_pass: e.target.checked })}
          />
          <span>Generator test pass</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.odour_pass}
            onChange={(e) => setV({ ...v, odour_pass: e.target.checked })}
          />
          <span>Odour pass</span>
        </label>
      </fieldset>
    </div>
  );
}
