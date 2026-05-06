import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { translateApiError } from "../../lib/translateApiError";
import { createInspection, type InspectionKind, type InspectionRead } from "./api";
import { CatchBasinForm } from "./forms/CatchBasinForm";
import { CctvForm } from "./forms/CctvForm";
import { HydrantFlowForm } from "./forms/HydrantFlowForm";
import { LiftStationForm } from "./forms/LiftStationForm";
import { ManholeForm } from "./forms/ManholeForm";
import { ValveExerciseForm } from "./forms/ValveExerciseForm";

const KINDS: { value: InspectionKind; label: string }[] = [
  { value: "hydrant_flow", label: "Hydrant flow test" },
  { value: "valve_exercise", label: "Valve exercise" },
  { value: "manhole", label: "Manhole" },
  { value: "catch_basin", label: "Catch basin" },
  { value: "lift_station_round", label: "Lift station round" },
  { value: "cctv", label: "CCTV (PACP)" },
];

interface Props {
  onClose: () => void;
}

export function CreateInspectionDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();

  const [kind, setKind] = useState<InspectionKind>("hydrant_flow");
  const [assetUid, setAssetUid] = useState("");
  const [woNumber, setWoNumber] = useState("");
  const [pass, setPass] = useState<"" | "true" | "false">("");
  const [overallCondition, setOverallCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [data, setData] = useState<Record<string, unknown>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useMutation<InspectionRead, Error>({
    mutationFn: () =>
      createInspection({
        kind,
        asset_uid: assetUid || undefined,
        work_order_number: woNumber || undefined,
        performed_at: new Date().toISOString(),
        overall_condition: overallCondition ? Number(overallCondition) : undefined,
        pass: pass === "" ? undefined : pass === "true",
        notes: notes || undefined,
        data,
      }),
    onSuccess: (ins) => {
      queryClient.invalidateQueries({ queryKey: ["inspections"] });
      navigate(`/${slug}/inspections/${ins.inspection_number}`);
    },
    onError: (err) => setErrorMessage(translateApiError(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    create.mutate();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !create.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, create.isPending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-inspection-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !create.isPending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-2xl rounded-lg bg-slate-900 p-5 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="new-inspection-title" className="text-lg font-semibold text-slate-100">
              New inspection
            </h2>
            <p className="text-xs text-slate-500">
              Tenant: <span className="text-slate-300">{slug}</span>
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

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-slate-300">Kind</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as InspectionKind);
                setData({});
              }}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-300">Asset UID (optional)</span>
            <input
              value={assetUid}
              onChange={(e) => setAssetUid(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </label>
        </div>

        <div className="rounded border border-slate-800 bg-slate-800/50 p-3">
          {kind === "hydrant_flow" && <HydrantFlowForm onChange={setData} />}
          {kind === "valve_exercise" && <ValveExerciseForm onChange={setData} />}
          {kind === "manhole" && <ManholeForm onChange={setData} />}
          {kind === "catch_basin" && <CatchBasinForm onChange={setData} />}
          {kind === "lift_station_round" && <LiftStationForm onChange={setData} />}
          {kind === "cctv" && <CctvForm onChange={setData} />}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-slate-300">Overall (1-5)</span>
            <input
              type="number"
              min={1}
              max={5}
              value={overallCondition}
              onChange={(e) => setOverallCondition(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-300">Pass?</span>
            <select
              value={pass}
              onChange={(e) => setPass(e.target.value as "" | "true" | "false")}
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              <option value="">—</option>
              <option value="true">Pass</option>
              <option value="false">Fail</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-300">Linked WO (optional)</span>
            <input
              value={woNumber}
              onChange={(e) => setWoNumber(e.target.value)}
              placeholder="WO-2026-00001"
              className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-slate-300">Notes</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </label>

        {errorMessage && <Alert>{errorMessage}</Alert>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
