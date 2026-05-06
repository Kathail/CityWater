import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import type {
  DuplicateCandidate,
  SrCategory,
  SrDomain,
  SrPriority,
} from "./api";
import { useCreateServiceRequest } from "./hooks";

const CATEGORIES: { value: SrCategory; label: string }[] = [
  { value: "low_pressure", label: "Low pressure" },
  { value: "no_water", label: "No water" },
  { value: "sewer_backup", label: "Sewer backup" },
  { value: "flooding", label: "Flooding" },
  { value: "odour", label: "Odour" },
  { value: "damaged_asset", label: "Damaged asset" },
  { value: "other", label: "Other" },
];

const DOMAINS: { value: SrDomain; label: string }[] = [
  { value: "water", label: "Water" },
  { value: "sewer", label: "Sewer" },
  { value: "storm", label: "Storm" },
];

const PRIORITIES: SrPriority[] = ["low", "normal", "high", "emergency"];

interface Props {
  onClose: () => void;
}

export function IntakeDialog({ onClose }: Props) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const create = useCreateServiceRequest();

  const [form, setForm] = useState({
    category: "other" as SrCategory,
    domain: "water" as SrDomain,
    priority: "normal" as SrPriority,
    caller_name: "",
    caller_phone: "",
    caller_email: "",
    address: "",
    description: "",
    lon: "",
    lat: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [createdSrNumber, setCreatedSrNumber] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const lon = form.lon.trim() ? Number(form.lon) : NaN;
    const lat = form.lat.trim() ? Number(form.lat) : NaN;
    const location =
      Number.isFinite(lon) && Number.isFinite(lat)
        ? ({ type: "Point", coordinates: [lon, lat] as [number, number] } as const)
        : undefined;

    try {
      const resp = await create.mutateAsync({
        category: form.category,
        domain: form.domain,
        priority: form.priority,
        caller_name: form.caller_name || undefined,
        caller_phone: form.caller_phone || undefined,
        caller_email: form.caller_email || undefined,
        address: form.address || undefined,
        description: form.description || undefined,
        location,
      });
      setCreatedSrNumber(resp.service_request.sr_number);
      setDuplicates(resp.duplicates);
      if (resp.duplicates.length === 0) {
        // No warnings — go straight to detail
        navigate(`/${slug}/service-requests/${resp.service_request.sr_number}`);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage(String(err));
    }
  }

  if (createdSrNumber && duplicates.length > 0) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-slate-900">
            Created {createdSrNumber}
          </h2>
          <p className="mt-2 text-sm text-amber-700">
            Found {duplicates.length} possible duplicate
            {duplicates.length === 1 ? "" : "s"} within 100 m / 7 days. Review before
            dispatching.
          </p>
          <ul className="mt-3 max-h-64 divide-y divide-slate-100 overflow-auto rounded border border-slate-200">
            {duplicates.map((d) => (
              <li key={d.sr_number} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.sr_number}</span>
                  <span className="text-xs text-slate-500">
                    {Math.round(d.distance_m)} m · {d.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {new Date(d.reported_at).toLocaleString()} · {d.category}
                </p>
                {d.description && (
                  <p className="mt-1 text-xs text-slate-700 line-clamp-2">
                    {d.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Close
            </button>
            <button
              onClick={() =>
                navigate(`/${slug}/service-requests/${createdSrNumber}`)
              }
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              Open new SR
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-xl space-y-3 rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-slate-900">New service request</h2>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Category">
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.category}
              onChange={(e) => update("category", e.target.value as SrCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Domain">
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.domain}
              onChange={(e) => update("domain", e.target.value as SrDomain)}
            >
              {DOMAINS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.priority}
              onChange={(e) => update("priority", e.target.value as SrPriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Caller name">
            <input
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.caller_name}
              onChange={(e) => update("caller_name", e.target.value)}
            />
          </Field>
          <Field label="Caller phone">
            <input
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.caller_phone}
              onChange={(e) => update("caller_phone", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Caller email">
          <input
            type="email"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={form.caller_email}
            onChange={(e) => update("caller_email", e.target.value)}
          />
        </Field>

        <Field label="Address">
          <input
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Longitude">
            <input
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.lon}
              placeholder="-76.5"
              onChange={(e) => update("lon", e.target.value)}
            />
          </Field>
          <Field label="Latitude">
            <input
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={form.lat}
              placeholder="39.3"
              onChange={(e) => update("lat", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            rows={3}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </Field>

        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
