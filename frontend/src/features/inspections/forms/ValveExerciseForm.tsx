import { useEffect, useState } from "react";

interface Props {
  onChange: (data: Record<string, unknown>) => void;
}

export function ValveExerciseForm({ onChange }: Props) {
  const [v, setV] = useState({
    turns_to_close: "",
    expected_turns: "",
    operates: true,
    leaks: false,
    torque_excessive: false,
    lubricated: false,
  });

  useEffect(() => {
    const out: Record<string, unknown> = { ...v };
    if (v.turns_to_close === "") delete out.turns_to_close;
    else out.turns_to_close = Number(v.turns_to_close);
    if (v.expected_turns === "") delete out.expected_turns;
    else out.expected_turns = Number(v.expected_turns);
    onChange(out);
  }, [v, onChange]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-slate-600">Turns to close</span>
          <input
            type="number"
            value={v.turns_to_close}
            onChange={(e) => setV({ ...v, turns_to_close: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Expected turns</span>
          <input
            type="number"
            value={v.expected_turns}
            onChange={(e) => setV({ ...v, expected_turns: e.target.value })}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        {(["operates", "leaks", "torque_excessive", "lubricated"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.checked })}
            />
            <span>{k.replace(/_/g, " ")}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
