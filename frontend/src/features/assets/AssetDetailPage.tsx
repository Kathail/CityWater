import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DetailHeader } from "../../components/DetailHeader";
import { ErrorState, LoadingState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { UnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { formatDate, formatDateTime } from "../../lib/format";
import { translateApiError } from "../../lib/translateApiError";
import { listInspections } from "../inspections/api";
import { listServiceRequests } from "../service-requests/api";
import { SR_STATUS_TONE } from "../service-requests/tones";
import { AreaChips } from "../tasks/AreaChips";
import { CreateWorkOrderDialog } from "../work-orders/CreateWorkOrderDialog";
import { listWorkOrders } from "../work-orders/api";
import { WO_STATUS_TONE } from "../work-orders/tones";
import { deleteAsset, updateAsset, type AssetOut, type AssetUpdateInput } from "./api";
import { useAsset } from "./hooks";

const STATUSES = ["active", "abandoned", "removed", "proposed"] as const;

interface FormState {
  material: string;
  diameter_mm: string;
  manufacturer: string;
  model: string;
  install_date: string;
  condition: string;
  criticality: string;
  status: (typeof STATUSES)[number];
  notes: string;
}

function toFormState(a: AssetOut): FormState {
  return {
    material: a.material ?? "",
    diameter_mm: a.diameter_mm?.toString() ?? "",
    manufacturer: a.manufacturer ?? "",
    model: a.model ?? "",
    install_date: a.install_date ?? "",
    condition: a.condition?.toString() ?? "",
    criticality: a.criticality?.toString() ?? "",
    status: a.status,
    notes: a.notes ?? "",
  };
}

function diff(prev: AssetOut, next: FormState): AssetUpdateInput {
  const out: AssetUpdateInput = {};
  const setIf = <K extends keyof AssetUpdateInput>(
    key: K,
    incoming: AssetUpdateInput[K],
    current: AssetUpdateInput[K],
  ) => {
    if (incoming !== current) out[key] = incoming;
  };
  setIf("material", next.material || null, prev.material);
  setIf("diameter_mm", next.diameter_mm === "" ? null : Number(next.diameter_mm), prev.diameter_mm);
  setIf("manufacturer", next.manufacturer || null, prev.manufacturer);
  setIf("model", next.model || null, prev.model);
  setIf("install_date", next.install_date || null, prev.install_date);
  setIf("condition", next.condition === "" ? null : Number(next.condition), prev.condition);
  setIf("criticality", next.criticality === "" ? null : Number(next.criticality), prev.criticality);
  setIf("status", next.status, prev.status);
  setIf("notes", next.notes || null, prev.notes);
  return out;
}

export function AssetDetailPage() {
  const params = useParams<{ slug: string; uid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assetQuery = useAsset(params.uid);
  const [form, setForm] = useState<FormState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createWoOpen, setCreateWoOpen] = useState(false);

  useEffect(() => {
    if (assetQuery.data) setForm(toFormState(assetQuery.data));
  }, [assetQuery.data]);

  const dirty = !!form && !!assetQuery.data && Object.keys(diff(assetQuery.data, form)).length > 0;

  const save = useMutation<AssetOut, Error, AssetUpdateInput>({
    mutationFn: (patch) => updateAsset(params.uid!, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(["asset", params.uid], saved);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setForm(toFormState(saved));
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(translateApiError(err));
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteAsset(params.uid!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      navigate(`/${params.slug}/assets`);
    },
    onError: (err) => {
      setDeleteError(translateApiError(err));
    },
  });

  if (assetQuery.isLoading || !form) {
    return <LoadingState />;
  }
  if (assetQuery.error) {
    return <ErrorState message={assetQuery.error.message} retry={() => assetQuery.refetch()} />;
  }
  const asset = assetQuery.data!;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !assetQuery.data) return;
    const patch = diff(assetQuery.data, form);
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl">
      <UnsavedChangesGuard dirty={dirty} />
      <DetailHeader
        backTo={`/${params.slug}/assets`}
        backLabel="Back to assets"
        title={asset.asset_uid}
        subtitle={`${asset.class_code} · ${asset.domain}`}
        meta={<AreaChips areas={asset.areas} domain={asset.domain} />}
        trailing={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/${params.slug}/map?focus=${encodeURIComponent(asset.asset_uid)}`}
              className="btn-ghost"
            >
              Show on map
            </Link>
            <Button onClick={() => setCreateWoOpen(true)}>Create work order</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              disabled={remove.isPending}
            >
              Delete
            </Button>
          </div>
        }
      />

      <RelatedWork slug={params.slug!} assetUid={asset.asset_uid} />

      {createWoOpen && (
        <CreateWorkOrderDialog
          onClose={() => setCreateWoOpen(false)}
          defaults={{ asset_uid: asset.asset_uid }}
        />
      )}

      {deleteOpen && (
        <ConfirmDialog
          title={`Soft-delete ${asset.asset_uid}?`}
          message="The asset will be hidden from lists and the map but kept in the database. An admin can restore it later."
          confirmLabel="Delete asset"
          errorMessage={deleteError}
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setDeleteOpen(false)}
        />
      )}

      <form
        onSubmit={onSubmit}
        className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3"
      >
        <h2 className="section-label-strong">Properties</h2>
        {errorMessage && <Alert>{errorMessage}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Material">
            <input
              value={form.material}
              onChange={(e) => update("material", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Diameter (mm)">
            <input
              type="number"
              value={form.diameter_mm}
              onChange={(e) => update("diameter_mm", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Manufacturer">
            <input
              value={form.manufacturer}
              onChange={(e) => update("manufacturer", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Model">
            <input
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Install date">
            <input
              type="date"
              value={form.install_date}
              onChange={(e) => update("install_date", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value as FormState["status"])}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm bg-slate-900"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={form.condition}
              onChange={(e) => update("condition", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Criticality (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              value={form.criticality}
              onChange={(e) => update("criticality", e.target.value)}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={3}
            className="block w-full rounded border border-slate-700 px-2 py-1 text-sm"
          />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <details className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <summary className="text-sm font-medium text-slate-200 cursor-pointer">
          Geometry (raw GeoJSON)
        </summary>
        <pre className="mt-3 overflow-x-auto text-xs text-slate-200">
          {JSON.stringify(asset.geometry, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/**
 * Three-column strip of recent activity tied to this asset. Each panel
 * pulls top 5 from the corresponding list endpoint with `?asset_uid=`,
 * shows a one-line row per item, and footer-links to the filtered list
 * for the full history. Empty states intentionally encourage the next
 * action ("No work orders — Create one") rather than just saying
 * "none" — the asset detail page is where operators land *because*
 * they're triaging a problem with this asset.
 */
function RelatedWork({ slug, assetUid }: { slug: string; assetUid: string }) {
  const woQuery = useQuery({
    queryKey: ["asset-related", "wo", assetUid],
    queryFn: () =>
      listWorkOrders({
        asset_uid: assetUid,
        status_in: "open,assigned,in_progress,on_hold",
        page_size: 5,
      }),
  });
  const insQuery = useQuery({
    queryKey: ["asset-related", "ins", assetUid],
    queryFn: () => listInspections({ asset_uid: assetUid, page_size: 5 }),
  });
  const srQuery = useQuery({
    queryKey: ["asset-related", "sr", assetUid],
    queryFn: () => listServiceRequests({ asset_uid: assetUid, page_size: 5 }),
  });

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Panel
        title="Open work orders"
        count={woQuery.data?.total}
        viewAllTo={`/${slug}/work-orders?asset_uid=${encodeURIComponent(assetUid)}`}
        loading={woQuery.isLoading}
      >
        {woQuery.data?.items.length === 0 ? (
          <Empty label="No open work" />
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {woQuery.data?.items.map((w) => (
              <li key={w.wo_number} className="py-2">
                <Link
                  to={`/${slug}/work-orders/${w.wo_number}`}
                  className="block group hover:text-slate-100"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-slate-400 group-hover:text-cyan-200">
                      {w.wo_number}
                    </span>
                    <StatusPill tone={WO_STATUS_TONE[w.status]} dot>
                      {w.status.replace(/_/g, " ")}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-200">{w.title}</div>
                  {w.due_by && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      due {formatDate(w.due_by)}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Recent inspections"
        count={insQuery.data?.total}
        viewAllTo={`/${slug}/inspections?asset_uid=${encodeURIComponent(assetUid)}`}
        loading={insQuery.isLoading}
      >
        {insQuery.data?.items.length === 0 ? (
          <Empty label="No inspections" />
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {insQuery.data?.items.map((i) => (
              <li key={i.inspection_number} className="py-2">
                <Link
                  to={`/${slug}/inspections/${i.inspection_number}`}
                  className="block group hover:text-slate-100"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-slate-400 group-hover:text-cyan-200">
                      {i.inspection_number}
                    </span>
                    <StatusPill
                      tone={i.pass === false ? "danger" : i.pass === true ? "success" : "muted"}
                      dot
                    >
                      {i.pass === false ? "fail" : i.pass === true ? "pass" : "—"}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-200">
                    {i.kind.replace(/_/g, " ")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDateTime(i.performed_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Service requests"
        count={srQuery.data?.total}
        viewAllTo={`/${slug}/service-requests?asset_uid=${encodeURIComponent(assetUid)}`}
        loading={srQuery.isLoading}
      >
        {srQuery.data?.items.length === 0 ? (
          <Empty label="No requests" />
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {srQuery.data?.items.map((s) => (
              <li key={s.sr_number} className="py-2">
                <Link
                  to={`/${slug}/service-requests/${s.sr_number}`}
                  className="block group hover:text-slate-100"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-slate-400 group-hover:text-cyan-200">
                      {s.sr_number}
                    </span>
                    <StatusPill tone={SR_STATUS_TONE[s.status]} dot>
                      {s.status}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-200">
                    {s.category.replace(/_/g, " ")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDateTime(s.reported_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function Panel({
  title,
  count,
  viewAllTo,
  loading,
  children,
}: {
  title: string;
  count?: number;
  viewAllTo: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-baseline justify-between border-b border-dashed border-slate-800 pb-2">
        <h3 className="section-label-strong">{title}</h3>
        {typeof count === "number" && count > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-slate-500">{count}</span>
        )}
      </div>
      {loading ? (
        <p className="py-2 text-xs text-slate-500">Loading…</p>
      ) : (
        children
      )}
      <div className="mt-3 border-t border-dashed border-slate-800 pt-2 text-right">
        <Link to={viewAllTo} className="text-[11px] uppercase tracking-wider text-slate-500 hover:text-signal">
          View all →
        </Link>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-2 text-xs text-slate-500">{label}.</p>;
}
