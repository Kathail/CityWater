import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { type ScheduleKind } from "./api";
import { useCreateSchedule } from "./hooks";

const RRULE_PRESETS: { label: string; rrule: string }[] = [
  { label: "Daily", rrule: "FREQ=DAILY" },
  { label: "Weekly (Monday)", rrule: "FREQ=WEEKLY;BYDAY=MO" },
  { label: "Monthly (1st)", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" },
  { label: "Quarterly", rrule: "FREQ=MONTHLY;INTERVAL=3" },
  { label: "Annually", rrule: "FREQ=YEARLY" },
];

const WO_CATEGORIES = [
  "main_break",
  "flushing",
  "valve_exercise",
  "cleaning",
  "inspection",
  "investigation",
  "repair",
  "install",
  "other",
];

const INSPECTION_KINDS = [
  "hydrant_flow",
  "valve_exercise",
  "manhole",
  "catch_basin",
  "lift_station_round",
  "cctv",
];

interface Props {
  onClose: () => void;
}

export function CreateScheduleDialog({ onClose }: Props) {
  const create = useCreateSchedule();
  const [kind, setKind] = useState<ScheduleKind>("work_order");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rrule, setRrule] = useState("FREQ=MONTHLY;BYMONTHDAY=1");
  const [assetUid, setAssetUid] = useState("");
  const [woCategory, setWoCategory] = useState("repair");
  const [woTitle, setWoTitle] = useState("");
  const [woPriority, setWoPriority] = useState("normal");
  const [insKind, setInsKind] = useState("manhole");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    const spec: Record<string, unknown> =
      kind === "work_order"
        ? {
            category: woCategory,
            priority: woPriority,
            title: woTitle.trim() || name.trim(),
          }
        : { kind: insKind };
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        rrule: rrule.trim(),
        spec,
        asset_uid: assetUid.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-xl space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-blue-500/5"
      >
        <h2 className="text-lg font-semibold text-slate-100">New schedule</h2>

        <label className="block text-sm">
          <span className="text-slate-300">Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Quarterly hydrant flushing — N grid"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-300">Description (optional)</span>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate-300">Kind</span>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as ScheduleKind)}
            >
              <option value="work_order">Work order</option>
              <option value="inspection">Inspection</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Asset UID (optional)</span>
            <input
              className="input font-mono"
              value={assetUid}
              onChange={(e) => setAssetUid(e.target.value)}
              placeholder="HYD-00001"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-300">Recurrence</span>
          <select
            className="input"
            value={
              RRULE_PRESETS.find((p) => p.rrule === rrule)?.rrule ?? "custom"
            }
            onChange={(e) => {
              if (e.target.value !== "custom") setRrule(e.target.value);
            }}
          >
            {RRULE_PRESETS.map((p) => (
              <option key={p.rrule} value={p.rrule}>
                {p.label} — {p.rrule}
              </option>
            ))}
            <option value="custom">Custom RRULE…</option>
          </select>
          <input
            className="input mt-2 font-mono"
            value={rrule}
            onChange={(e) => setRrule(e.target.value)}
            placeholder="FREQ=MONTHLY;BYMONTHDAY=1"
          />
          <p className="mt-1 text-xs text-slate-500">
            iCalendar RRULE (RFC 5545). The server validates before saving.
          </p>
        </label>

        {kind === "work_order" ? (
          <div className="surface space-y-2 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Work order template
            </p>
            <label className="block text-sm">
              <span className="text-slate-300">Title (defaults to name)</span>
              <input
                className="input"
                value={woTitle}
                onChange={(e) => setWoTitle(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="text-slate-300">Category</span>
                <select
                  className="input"
                  value={woCategory}
                  onChange={(e) => setWoCategory(e.target.value)}
                >
                  {WO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-300">Priority</span>
                <select
                  className="input"
                  value={woPriority}
                  onChange={(e) => setWoPriority(e.target.value)}
                >
                  {["low", "normal", "high", "emergency"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : (
          <div className="surface space-y-2 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Inspection template
            </p>
            <label className="block text-sm">
              <span className="text-slate-300">Inspection kind</span>
              <select
                className="input"
                value={insKind}
                onChange={(e) => setInsKind(e.target.value)}
              >
                {INSPECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {errorMessage && (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
