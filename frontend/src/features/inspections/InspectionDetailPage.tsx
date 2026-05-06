import { Link, useParams } from "react-router-dom";
import { useInspection } from "./hooks";

export function InspectionDetailPage() {
  const { slug, n } = useParams<{ slug: string; n: string }>();
  const insQuery = useInspection(n);

  if (insQuery.isLoading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (insQuery.error) return <div className="p-8 text-red-600">{insQuery.error.message}</div>;
  const ins = insQuery.data!;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link to={`/${slug}/inspections`} className="text-sm text-slate-500 hover:underline">
          ← Back to inspections
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{ins.inspection_number}</h1>
        <p className="text-base text-slate-700">{ins.kind.replace(/_/g, " ")}</p>
        <p className="text-xs text-slate-500">
          Performed {ins.performed_at.slice(0, 16).replace("T", " ")}
          {ins.asset_uid && (
            <>
              {" · "}
              <Link to={`/${slug}/assets/${ins.asset_uid}`} className="font-mono hover:underline">
                {ins.asset_uid}
              </Link>
            </>
          )}
          {ins.work_order_number && (
            <>
              {" · "}
              <Link
                to={`/${slug}/work-orders/${ins.work_order_number}`}
                className="font-mono hover:underline"
              >
                {ins.work_order_number}
              </Link>
            </>
          )}
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500 mb-2">Summary</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-slate-500">Overall condition</dt>
          <dd>{ins.overall_condition ?? "—"}</dd>
          <dt className="text-slate-500">Pass</dt>
          <dd>{ins.pass === null ? "—" : ins.pass ? "Pass" : "Fail"}</dd>
        </dl>
        {ins.notes && (
          <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{ins.notes}</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500 mb-2">
          {ins.kind.replace(/_/g, " ")} data
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          {Object.entries(ins.data).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500 font-mono text-xs">{k}</dt>
              <dd className="text-slate-800">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
