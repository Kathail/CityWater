import { apiJson } from "../../lib/apiClient";

export type ReportFilterType =
  | "date"
  | "asset_class_code"
  | "inspection_kind"
  | "domain";

export interface ReportFilter {
  name: string;
  type: ReportFilterType;
}

export interface ReportCatalogEntry {
  slug: string;
  title: string;
  description: string;
  filters: ReportFilter[];
}

export interface ReportPayload {
  title: string;
  subtitle: string;
  headers: string[];
  rows: (string | number | null)[][];
  generated_at: string;
  tenant: string;
}

export function listReports(): Promise<ReportCatalogEntry[]> {
  return apiJson<ReportCatalogEntry[]>("/api/v1/reports");
}

export function runReport(
  slug: string,
  params: Record<string, string>,
): Promise<ReportPayload> {
  const search = new URLSearchParams(params);
  search.delete("format");
  const qs = search.toString();
  return apiJson<ReportPayload>(
    `/api/v1/reports/${slug}${qs ? `?${qs}` : ""}`,
  );
}

export function downloadUrl(
  slug: string,
  format: "csv" | "pdf",
  params: Record<string, string>,
): string {
  const search = new URLSearchParams(params);
  search.set("format", format);
  return `/api/v1/reports/${slug}?${search.toString()}`;
}
