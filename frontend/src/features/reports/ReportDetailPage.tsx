import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../../components/States";
import { translateApiError } from "../../lib/translateApiError";
import { downloadUrl } from "./api";
import { useReport, useReportCatalog } from "./hooks";

const DOMAIN_OPTIONS = ["water", "sewer", "storm"];
const INSPECTION_KINDS = [
  "cctv",
  "hydrant_flow",
  "valve_exercise",
  "manhole",
  "catch_basin",
  "lift_station_round",
];

export function ReportDetailPage() {
  const { slug, reportSlug } = useParams<{ slug: string; reportSlug: string }>();
  const [search, setSearch] = useSearchParams();
  const catalog = useReportCatalog();

  const params = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of search.entries()) {
      if (v !== "") out[k] = v;
    }
    return out;
  }, [search]);

  const report = useReport(reportSlug, params);

  const meta = catalog.data?.find((r) => r.slug === reportSlug);

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(search);
    if (!value) next.delete(name);
    else next.set(name, value);
    setSearch(next);
  }

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/${slug}/reports`}
            className="text-xs uppercase text-slate-400 hover:underline"
          >
            ← All reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            {report.data?.title ?? meta?.title ?? reportSlug}
          </h1>
          {report.data && <p className="text-sm text-slate-400">{report.data.subtitle}</p>}
        </div>
        <div className="flex gap-2">
          {reportSlug && (
            <>
              {/* Download buttons must stay anchors (not <Button>) so the
                  browser handles the download attribute + content-disposition;
                  match the .btn-* utility styling for visual consistency
                  with the rest of the app. */}
              <a href={downloadUrl(reportSlug, "csv", params)} className="btn-ghost" download>
                Download CSV
              </a>
              <a href={downloadUrl(reportSlug, "pdf", params)} className="btn-primary" download>
                Download PDF
              </a>
            </>
          )}
        </div>
      </div>

      {meta && meta.filters.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          {meta.filters.map((f) => (
            <FilterField
              key={f.name}
              name={f.name}
              type={f.type}
              value={search.get(f.name) ?? ""}
              onChange={(v) => setFilter(f.name, v)}
            />
          ))}
        </div>
      )}

      {report.isLoading && <LoadingState label="Running…" />}
      {report.isError && (
        <ErrorState message={translateApiError(report.error)} retry={() => report.refetch()} />
      )}

      {report.data && (
        <div className="overflow-auto rounded border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 text-left text-xs uppercase text-slate-400">
              <tr>
                {report.data.headers.map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {report.data.rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-800/50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2">
                      {cell === null || cell === "" ? "—" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
              {report.data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={report.data.headers.length}
                    className="p-6 text-center text-slate-400"
                  >
                    No data for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterField({
  name,
  type,
  value,
  onChange,
}: {
  name: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputClass = "mt-1 rounded border border-slate-700 px-2 py-1 text-sm";
  if (type === "date") {
    return (
      <label>
        <span className="block text-slate-300">{name}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      </label>
    );
  }
  if (type === "domain") {
    return (
      <label>
        <span className="block text-slate-300">{name}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">All</option>
          {DOMAIN_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (type === "inspection_kind") {
    return (
      <label>
        <span className="block text-slate-300">{name}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">All</option>
          {INSPECTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
    );
  }
  // asset_class_code or unknown — free text
  return (
    <label>
      <span className="block text-slate-300">{name}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="WAT_MAIN"
        className={inputClass}
      />
    </label>
  );
}
