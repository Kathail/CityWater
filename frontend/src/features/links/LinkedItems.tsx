import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import { useInspections } from "../inspections/hooks";
import { useServiceRequests } from "../service-requests/hooks";
import { useWorkOrders } from "../work-orders/hooks";
import { type LinkEntityType, type LinkKind, type LinkRead } from "./api";
import { useCreateLink, useDeleteLink, useLinks } from "./hooks";

const ENTITY_LABELS: Record<LinkEntityType, string> = {
  work_order: "Work order",
  inspection: "Inspection",
  service_request: "Service request",
};

const KIND_LABELS: Record<LinkKind, string> = {
  parent_of: "is parent of",
  related: "related to",
  caused_by: "caused by",
};

const KIND_PILL: Record<LinkKind, string> = {
  parent_of: "bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/30",
  related: "bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/30",
  caused_by: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30",
};

interface Props {
  /** The entity this section is rendered against. */
  entityType: LinkEntityType;
  entityId: number;
}

export function LinkedItems({ entityType, entityId }: Props) {
  const links = useLinks(entityType, entityId);
  const remove = useDeleteLink(entityType, entityId);
  const [adding, setAdding] = useState(false);

  return (
    <section className="surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Linked items
        </h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
        >
          {adding ? "Cancel" : "+ Link an item"}
        </button>
      </div>

      {adding && (
        <AddLinkForm
          sourceType={entityType}
          sourceId={entityId}
          onDone={() => setAdding(false)}
        />
      )}

      <ul className="mt-3 divide-y divide-slate-800">
        {links.isLoading && (
          <li className="py-3 text-sm text-slate-400">Loading…</li>
        )}
        {links.isError && (
          <li className="py-3 text-sm text-red-400">
            Failed to load linked items.
          </li>
        )}
        {links.data && links.data.items.length === 0 && (
          <li className="py-3 text-sm text-slate-500">
            No linked items yet.
          </li>
        )}
        {links.data?.items.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            self={{ type: entityType, id: entityId }}
            onRemove={() => remove.mutate(link.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function LinkRow({
  link,
  self,
  onRemove,
}: {
  link: LinkRead;
  self: { type: LinkEntityType; id: number };
  onRemove: () => void;
}) {
  const { slug } = useParams<{ slug: string }>();
  // Determine which side of the link is "the other" relative to `self`.
  const showingOther =
    link.source_type === self.type && link.source_id === self.id;
  const otherType = showingOther ? link.target_type : link.source_type;
  const otherRef = showingOther ? link.target_ref : link.source_ref;
  const directionLabel =
    showingOther ? KIND_LABELS[link.kind] : `${KIND_LABELS[link.kind]} (incoming)`;

  const path = otherRef
    ? otherType === "work_order"
      ? `/${slug}/work-orders/${otherRef}`
      : otherType === "service_request"
        ? `/${slug}/service-requests/${otherRef}`
        : `/${slug}/inspections/${otherRef}`
    : null;

  return (
    <li className="py-3 text-sm flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500">
          {ENTITY_LABELS[self.type]} {directionLabel}
        </p>
        <p className="mt-0.5 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_PILL[link.kind]}`}>
            {ENTITY_LABELS[otherType]}
          </span>
          {path && otherRef ? (
            <Link
              to={path}
              className="font-mono text-slate-100 hover:text-blue-300 hover:underline"
            >
              {otherRef}
            </Link>
          ) : (
            <span className="font-mono text-slate-500">
              {otherRef ?? "(deleted)"}
            </span>
          )}
        </p>
        {link.note && (
          <p className="mt-1 text-xs text-slate-400">{link.note}</p>
        )}
      </div>
      <button
        onClick={onRemove}
        className="btn-ghost px-2 py-1 text-xs"
        title="Remove link"
      >
        Unlink
      </button>
    </li>
  );
}

function AddLinkForm({
  sourceType,
  sourceId,
  onDone,
}: {
  sourceType: LinkEntityType;
  sourceId: number;
  onDone: () => void;
}) {
  const [targetType, setTargetType] = useState<LinkEntityType>(
    sourceType === "service_request" ? "work_order" : "service_request",
  );
  const [targetRef, setTargetRef] = useState("");
  const [kind, setKind] = useState<LinkKind>("related");
  const [note, setNote] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useCreateLink(sourceType, sourceId);

  // Pull a small list of candidates so the user can pick by code rather
  // than memorizing numeric ids — we resolve the code to id locally.
  const wos = useWorkOrders({ page: 1, page_size: 200 });
  const srs = useServiceRequests({ page: 1, page_size: 200 });
  const ins = useInspections({ page: 1, page_size: 200 });

  async function lookupId(): Promise<number | null> {
    const ref = targetRef.trim();
    if (!ref) return null;
    const path =
      targetType === "work_order"
        ? `/api/v1/work-orders/${encodeURIComponent(ref)}`
        : targetType === "service_request"
          ? `/api/v1/service-requests/${encodeURIComponent(ref)}`
          : `/api/v1/inspections/${encodeURIComponent(ref)}`;
    const resp = await fetch(path, { credentials: "include" });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { id?: number };
    return body.id ?? null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    const targetId = await lookupId();
    if (targetId === null) {
      setErrorMessage(`Couldn't find that ${ENTITY_LABELS[targetType]}.`);
      return;
    }
    try {
      await create.mutateAsync({
        source_type: sourceType,
        source_id: sourceId,
        target_type: targetType,
        target_id: targetId,
        kind,
        note: note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : String(err));
    }
  }

  // Datalist hints — show recent codes for the chosen target type.
  const hints =
    targetType === "work_order"
      ? wos.data?.items.map((w) => w.wo_number) ?? []
      : targetType === "service_request"
        ? srs.data?.items.map((s) => s.sr_number) ?? []
        : ins.data?.items.map((i) => i.inspection_number) ?? [];

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3 text-sm"
    >
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-xs">
          <span className="text-slate-400">Type</span>
          <select
            className="input"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as LinkEntityType)}
          >
            <option value="work_order">Work order</option>
            <option value="service_request">Service request</option>
            <option value="inspection">Inspection</option>
          </select>
        </label>
        <label className="block text-xs col-span-2">
          <span className="text-slate-400">Number</span>
          <input
            className="input font-mono"
            list="link-target-hints"
            value={targetRef}
            onChange={(e) => setTargetRef(e.target.value)}
            placeholder={
              targetType === "work_order"
                ? "WO-2026-00001"
                : targetType === "service_request"
                  ? "SR-2026-00001"
                  : "INS-2026-00001"
            }
            required
          />
          <datalist id="link-target-hints">
            {hints.slice(0, 30).map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </label>
      </div>

      <label className="block text-xs">
        <span className="text-slate-400">Relationship</span>
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as LinkKind)}
        >
          <option value="related">Related to</option>
          <option value="caused_by">Caused by</option>
          <option value="parent_of">Is parent of</option>
        </select>
      </label>

      <label className="block text-xs">
        <span className="text-slate-400">Note (optional)</span>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Why are these linked?"
        />
      </label>

      {errorMessage && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="submit" disabled={create.isPending} className="btn-primary px-3 py-1.5 text-xs">
          {create.isPending ? "Linking…" : "Link"}
        </button>
      </div>
    </form>
  );
}

